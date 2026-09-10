#include "MediaBridge.h"
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavfilter/avfilter.h>
#include <libavfilter/buffersrc.h>
#include <libavfilter/buffersink.h>
#include <libavutil/opt.h>
#include <libavutil/mathematics.h>
#include <stdio.h>
#include <string.h>

typedef struct {
    AVCodecContext *decoder, *encoder;
    AVStream *input, *output;
    AVFilterGraph *graph;
    AVFilterContext *source, *sink;
    int64_t start;
} ConvertStream;

static int input_open(const char *path, AVFormatContext **input) {
    if (!path || path[0]!='/') return AVERROR(EINVAL);
    AVDictionary *options=NULL;
    av_dict_set(&options,"protocol_whitelist","file",0);
    av_dict_set(&options,"allowed_extensions","ALL",0);
    // App-generated local segments use .plain, independent of their format.
    av_dict_set(&options,"extension_picky","0",0);
    av_dict_set(&options,"safe","0",0);
    int r=avformat_open_input(input,path,NULL,&options);
    av_dict_free(&options);
    return r<0 ? r : avformat_find_stream_info(*input,NULL);
}

static int encoder_drain(ConvertStream *s, AVFormatContext *output, AVFrame *frame) {
    int r=avcodec_send_frame(s->encoder,frame);
    if (r<0) return r;
    AVPacket *packet=av_packet_alloc(); if (!packet) return AVERROR(ENOMEM);
    while ((r=avcodec_receive_packet(s->encoder,packet))>=0) {
        av_packet_rescale_ts(packet,s->encoder->time_base,s->output->time_base);
        packet->stream_index=s->output->index; packet->pos=-1;
        r=av_interleaved_write_frame(output,packet);
        av_packet_unref(packet);
        if (r<0) break;
    }
    av_packet_free(&packet);
    return r==AVERROR(EAGAIN) || r==AVERROR_EOF ? 0 : r;
}

static int filter_open(ConvertStream *s, const AVFrame *frame) {
    int video=s->decoder->codec_type==AVMEDIA_TYPE_VIDEO, r=AVERROR(ENOMEM);
    AVBufferSrcParameters *p=NULL;
    AVFilterInOut *inputs=NULL,*outputs=NULL;
    s->graph=avfilter_graph_alloc(); if (!s->graph) goto done;
    s->graph->nb_threads=2;
    s->source=avfilter_graph_alloc_filter(s->graph,avfilter_get_by_name(video?"buffer":"abuffer"),"source");
    if (!s->source) goto done;
    p=av_buffersrc_parameters_alloc(); if (!p) goto done;
    p->format=frame->format; p->time_base=s->input->time_base;
    if (video) {
        p->width=frame->width; p->height=frame->height;
        p->sample_aspect_ratio=frame->sample_aspect_ratio.num ? frame->sample_aspect_ratio : (AVRational){1,1};
    } else {
        p->sample_rate=frame->sample_rate;
        if (av_channel_layout_copy(&p->ch_layout,&frame->ch_layout)<0) goto done;
    }
    if ((r=av_buffersrc_parameters_set(s->source,p))<0 || (r=avfilter_init_str(s->source,NULL))<0) goto done;
    if ((r=avfilter_graph_create_filter(&s->sink,avfilter_get_by_name(video?"buffersink":"abuffersink"),"sink",NULL,NULL,s->graph))<0) goto done;
    char filters[512],layout[128];
    if (video) snprintf(filters,sizeof(filters),"scale=%d:%d,format=pix_fmts=nv12",s->encoder->width,s->encoder->height);
    else {
        if ((r=av_channel_layout_describe(&s->encoder->ch_layout,layout,sizeof(layout)))<0) goto done;
        snprintf(filters,sizeof(filters),"aresample=%d,aformat=sample_fmts=fltp:channel_layouts='%s'",s->encoder->sample_rate,layout);
    }
    inputs=avfilter_inout_alloc(); outputs=avfilter_inout_alloc();
    if (!inputs || !outputs) { r=AVERROR(ENOMEM); goto done; }
    inputs->name=av_strdup("out"); inputs->filter_ctx=s->sink; inputs->pad_idx=0;
    outputs->name=av_strdup("in"); outputs->filter_ctx=s->source; outputs->pad_idx=0;
    if (!inputs->name || !outputs->name) { r=AVERROR(ENOMEM); goto done; }
    if ((r=avfilter_graph_parse_ptr(s->graph,filters,&inputs,&outputs,NULL))<0 || (r=avfilter_graph_config(s->graph,NULL))<0) goto done;
    if (!video) av_buffersink_set_frame_size(s->sink,s->encoder->frame_size);
    r=0;
done:
    if (p) av_channel_layout_uninit(&p->ch_layout);
    av_free(p); avfilter_inout_free(&inputs); avfilter_inout_free(&outputs);
    return r;
}

static int filter_drain(ConvertStream *s, AVFormatContext *output, AVFrame *frame) {
    int r=av_buffersrc_add_frame_flags(s->source,frame,AV_BUFFERSRC_FLAG_KEEP_REF);
    if (r<0) return r;
    AVFrame *filtered=av_frame_alloc(); if (!filtered) return AVERROR(ENOMEM);
    while ((r=av_buffersink_get_frame(s->sink,filtered))>=0) {
        AVRational from=av_buffersink_get_time_base(s->sink);
        if (filtered->pts!=AV_NOPTS_VALUE) filtered->pts=av_rescale_q(filtered->pts,from,s->encoder->time_base);
        filtered->duration=av_rescale_q(filtered->duration,from,s->encoder->time_base);
        r=encoder_drain(s,output,filtered);
        av_frame_unref(filtered);
        if (r<0) break;
    }
    av_frame_free(&filtered);
    return r==AVERROR(EAGAIN) || r==AVERROR_EOF ? 0 : r;
}

static int decode(ConvertStream *s, AVFormatContext *output, AVPacket *packet) {
    int r=avcodec_send_packet(s->decoder,packet);
    if (r<0) return r;
    AVFrame *frame=av_frame_alloc(); if (!frame) return AVERROR(ENOMEM);
    while ((r=avcodec_receive_frame(s->decoder,frame))>=0) {
        frame->pts=frame->best_effort_timestamp;
        if (frame->pts==AV_NOPTS_VALUE) { r=AVERROR_INVALIDDATA; break; }
        frame->pts-=s->start;
        if (!s->graph && (r=filter_open(s,frame))<0) break;
        r=filter_drain(s,output,frame);
        av_frame_unref(frame);
        if (r<0) break;
    }
    av_frame_free(&frame);
    if (r!=AVERROR(EAGAIN) && r!=AVERROR_EOF && r<0) return r;
    if (!packet) {
        if (!s->graph) return AVERROR_INVALIDDATA;
        if ((r=filter_drain(s,output,NULL))<0) return r;
        return encoder_drain(s,output,NULL);
    }
    return 0;
}

static int stream_open(ConvertStream *s, AVFormatContext *input, AVStream *stream, AVFormatContext *output) {
    s->input=stream;
    const AVCodec *decoder=stream->codecpar->codec_id==AV_CODEC_ID_AV1 ? avcodec_find_decoder_by_name("libdav1d") : avcodec_find_decoder(stream->codecpar->codec_id);
    if (!decoder) return -2;
    s->decoder=avcodec_alloc_context3(decoder); if (!s->decoder) return AVERROR(ENOMEM);
    int r=avcodec_parameters_to_context(s->decoder,stream->codecpar); if (r<0) return r;
    s->decoder->pkt_timebase=stream->time_base; s->decoder->thread_count=2;
    if ((r=avcodec_open2(s->decoder,decoder,NULL))<0) return r;
    int video=stream->codecpar->codec_type==AVMEDIA_TYPE_VIDEO;
    const AVCodec *encoder=video ? avcodec_find_encoder_by_name("h264_videotoolbox") : avcodec_find_encoder(AV_CODEC_ID_AAC);
    if (!encoder) return -3;
    s->encoder=avcodec_alloc_context3(encoder); if (!s->encoder) return AVERROR(ENOMEM);
    if (video) {
        if (s->decoder->width<=0 || s->decoder->height<=0 || s->decoder->width>16384 || s->decoder->height>16384) return AVERROR_INVALIDDATA;
        s->encoder->width=(s->decoder->width+1)&~1; s->encoder->height=(s->decoder->height+1)&~1;
        s->encoder->pix_fmt=AV_PIX_FMT_NV12; s->encoder->time_base=stream->time_base;
        s->encoder->framerate=av_guess_frame_rate(input,stream,NULL);
        if (!s->encoder->framerate.num) s->encoder->framerate=(AVRational){30,1};
        s->encoder->sample_aspect_ratio=s->decoder->sample_aspect_ratio;
        s->encoder->color_primaries=s->decoder->color_primaries; s->encoder->color_trc=s->decoder->color_trc;
        s->encoder->colorspace=s->decoder->colorspace; s->encoder->color_range=s->decoder->color_range;
        s->encoder->bit_rate=FFMIN(40000000,FFMAX(1000000,(int64_t)s->encoder->width*s->encoder->height*6));
        s->encoder->max_b_frames=0; s->encoder->gop_size=60;
    } else {
        s->encoder->sample_fmt=AV_SAMPLE_FMT_FLTP; s->encoder->sample_rate=48000;
        s->encoder->time_base=(AVRational){1,48000}; s->encoder->bit_rate=192000;
        if (s->decoder->ch_layout.nb_channels<=0) return AVERROR_INVALIDDATA;
        if (s->decoder->ch_layout.order==AV_CHANNEL_ORDER_UNSPEC) av_channel_layout_default(&s->encoder->ch_layout,s->decoder->ch_layout.nb_channels);
        else if ((r=av_channel_layout_copy(&s->encoder->ch_layout,&s->decoder->ch_layout))<0) return r;
    }
    if (output->oformat->flags & AVFMT_GLOBALHEADER) s->encoder->flags|=AV_CODEC_FLAG_GLOBAL_HEADER;
    AVDictionary *options=NULL;
    if (video) av_dict_set(&options,"allow_sw","1",0);
    r=avcodec_open2(s->encoder,encoder,&options); av_dict_free(&options);
    if (r<0) return video ? -3 : r;
    s->output=avformat_new_stream(output,NULL); if (!s->output) return AVERROR(ENOMEM);
    if ((r=avcodec_parameters_from_context(s->output->codecpar,s->encoder))<0) return r;
    s->output->time_base=s->encoder->time_base;
    av_dict_copy(&s->output->metadata,stream->metadata,0);
    s->start=input->start_time==AV_NOPTS_VALUE ? 0 : av_rescale_q(input->start_time,AV_TIME_BASE_Q,stream->time_base);
    return 0;
}

static int next(AVFormatContext *input, AVPacket *packet, ConvertStream **streams) {
    int r;
    while ((r=av_read_frame(input,packet))>=0) {
        if (streams[packet->stream_index]) return 1;
        av_packet_unref(packet);
    }
    return r==AVERROR_EOF ? 0 : r;
}

int harbor_transcode(const char *video, const char *audio, const char *destination) {
    AVFormatContext *input[2]={NULL,NULL},*output=NULL;
    ConvertStream **streams[2]={NULL,NULL}; AVPacket *packets[2]={NULL,NULL};
    int count=audio && strlen(audio) ? 2 : 1, result=AVERROR_INVALIDDATA, ready[2]={0,0}, has_video=0, has_audio=0;
    av_log_set_level(AV_LOG_QUIET);
    if (!destination || destination[0]!='/') goto done;
    if (input_open(video,&input[0])<0 || (count==2 && input_open(audio,&input[1])<0)) goto done;
    if (avformat_alloc_output_context2(&output,NULL,"mp4",destination)<0) goto done;
    for (int k=0;k<count;k++) {
        streams[k]=av_calloc(input[k]->nb_streams,sizeof(*streams[k])); if (!streams[k]) goto done;
        for (unsigned i=0;i<input[k]->nb_streams;i++) {
            AVStream *s=input[k]->streams[i];
            int v=k==0 && s->codecpar->codec_type==AVMEDIA_TYPE_VIDEO && !has_video;
            int a=k==count-1 && s->codecpar->codec_type==AVMEDIA_TYPE_AUDIO && (count==1 || !has_audio);
            if (!v && !a) continue;
            streams[k][i]=av_mallocz(sizeof(ConvertStream)); if (!streams[k][i]) goto done;
            result=stream_open(streams[k][i],input[k],s,output); if (result<0) goto done;
            result=AVERROR_INVALIDDATA;
            has_video|=v; has_audio|=a;
        }
        packets[k]=av_packet_alloc(); if (!packets[k]) goto done;
    }
    result=AVERROR_INVALIDDATA;
    if (!has_video || (count==2 && !has_audio) || avio_open(&output->pb,destination,AVIO_FLAG_WRITE)<0) goto done;
    AVDictionary *options=NULL; av_dict_set(&options,"movflags","+faststart",0);
    int header=avformat_write_header(output,&options); av_dict_free(&options); if (header<0) goto done;
    for (int k=0;k<count;k++) ready[k]=next(input[k],packets[k],streams[k]);
    while (ready[0] || ready[1]) {
        if (ready[0]<0 || ready[1]<0) goto done;
        int k=ready[0]?0:1;
        if (ready[0] && ready[1]) {
            ConvertStream *a=streams[0][packets[0]->stream_index],*b=streams[1][packets[1]->stream_index];
            if (packets[0]->dts==AV_NOPTS_VALUE || packets[1]->dts==AV_NOPTS_VALUE) goto done;
            if (av_compare_ts(packets[0]->dts-a->start,a->input->time_base,packets[1]->dts-b->start,b->input->time_base)>0) k=1;
        }
        int r=decode(streams[k][packets[k]->stream_index],output,packets[k]);
        av_packet_unref(packets[k]); if (r<0) { result=r; goto done; }
        ready[k]=next(input[k],packets[k],streams[k]);
    }
    for (int k=0;k<count;k++) for (unsigned i=0;i<input[k]->nb_streams;i++) if (streams[k][i]) {
        int r=decode(streams[k][i],output,NULL); if (r<0) { result=r; goto done; }
    }
    result=av_write_trailer(output);
done:
    for (int k=0;k<2;k++) {
        if (streams[k]) for (unsigned i=0;input[k] && i<input[k]->nb_streams;i++) if (streams[k][i]) {
            ConvertStream *s=streams[k][i]; avfilter_graph_free(&s->graph);
            avcodec_free_context(&s->decoder); avcodec_free_context(&s->encoder); av_free(s);
        }
        av_free(streams[k]); av_packet_free(&packets[k]); avformat_close_input(&input[k]);
    }
    if (output) { if (output->pb) avio_closep(&output->pb); avformat_free_context(output); }
    return result;
}
