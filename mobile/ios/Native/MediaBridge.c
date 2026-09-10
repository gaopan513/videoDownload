#include "MediaBridge.h"
#include <CommonCrypto/CommonCryptor.h>
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/mathematics.h>
#include <string.h>
#include <stdio.h>

static int open_local(const char *path, AVFormatContext **ctx) {
    if (!path || path[0] != '/') return AVERROR(EINVAL);
    AVDictionary *options = NULL;
    av_dict_set(&options, "protocol_whitelist", "file", 0);
    av_dict_set(&options, "allowed_extensions", "ALL", 0);
    // Generated ffconcat files pass local HLS options to their child demuxers.
    // Protocols remain file-only; no network URLs are opened during remuxing.
    av_dict_set(&options, "safe", "0", 0);
    // Never print media paths (which may include sensitive titles) into CI/device logs.
    av_log_set_level(AV_LOG_QUIET);
    int r = avformat_open_input(ctx, path, NULL, &options);
    av_dict_free(&options);
    if (r < 0) return r;
    return avformat_find_stream_info(*ctx, NULL);
}
static int mp4_codec(enum AVCodecID codec, enum AVMediaType type) {
    if (type==AVMEDIA_TYPE_VIDEO) return codec==AV_CODEC_ID_H264 || codec==AV_CODEC_ID_HEVC || codec==AV_CODEC_ID_AV1 || codec==AV_CODEC_ID_MPEG4;
    if (type==AVMEDIA_TYPE_AUDIO) return codec==AV_CODEC_ID_AAC || codec==AV_CODEC_ID_MP3 || codec==AV_CODEC_ID_AC3 || codec==AV_CODEC_ID_EAC3 || codec==AV_CODEC_ID_ALAC;
    return 1;
}
int harbor_probe_mode(const char *path, int require_video, int require_audio, int mode) {
    if (mode<0 || mode>2) return -2;
    AVFormatContext *ctx = NULL;
    int result = 0, video = 0, audio = 0;
    if (open_local(path, &ctx) < 0) goto end;
    for (unsigned i=0; i<ctx->nb_streams; i++) {
        AVCodecParameters *p = ctx->streams[i]->codecpar;
        if (p->codec_type == AVMEDIA_TYPE_VIDEO) video++;
        else if (p->codec_type == AVMEDIA_TYPE_AUDIO) audio++;
        else continue;
        if ((mode==0 && !mp4_codec(p->codec_id,p->codec_type)) ||
            (mode==1 && avformat_query_codec(av_guess_format("matroska",NULL,NULL),p->codec_id,FF_COMPLIANCE_NORMAL)==0) ||
            (mode==2 && !avcodec_find_decoder(p->codec_id))) { result=-2; goto end; }
    }
    if ((!require_video || video) && (!require_audio || audio) && (video || audio)) result=1;
end:
    avformat_close_input(&ctx); return result;
}
int harbor_probe(const char *path, int require_video, int require_audio) { return harbor_probe_mode(path,require_video,require_audio,0); }
double harbor_duration(const char *path) {
    AVFormatContext *ctx=NULL;
    double duration=0;
    if (open_local(path,&ctx)>=0 && ctx->duration!=AV_NOPTS_VALUE && ctx->duration>0) duration=(double)ctx->duration/AV_TIME_BASE;
    avformat_close_input(&ctx);
    return duration;
}
void harbor_codecs(const char *path, char *text, size_t capacity) {
    if (!text || !capacity) return;
    text[0]=0; AVFormatContext *ctx=NULL; size_t used=0;
    if (open_local(path,&ctx)<0) { avformat_close_input(&ctx); return; }
    for (unsigned i=0;i<ctx->nb_streams && used<capacity-1;i++) {
        AVCodecParameters *p=ctx->streams[i]->codecpar;
        if (p->codec_type!=AVMEDIA_TYPE_VIDEO && p->codec_type!=AVMEDIA_TYPE_AUDIO) continue;
        int n=snprintf(text+used,capacity-used,"%s%s: %s",used?"; ":"",p->codec_type==AVMEDIA_TYPE_VIDEO?"video":"audio",avcodec_get_name(p->codec_id));
        if (n<0 || (size_t)n>=capacity-used) break;
        used+=(size_t)n;
    }
    avformat_close_input(&ctx);
}
static int next_packet(AVFormatContext *ctx, AVPacket *packet, int *map) {
    int r;
    while ((r=av_read_frame(ctx, packet)) >= 0) {
        if (map[packet->stream_index] >= 0) return 1;
        av_packet_unref(packet);
    }
    return r == AVERROR_EOF ? 0 : -1;
}
static int remux_files(const char *video_path, const char *audio_path, const char *output_path, int mode) {
    AVFormatContext *in[2]={NULL,NULL}, *out=NULL;
    AVPacket *packets[2]={NULL,NULL};
    int *maps[2]={NULL,NULL}, ready[2]={0,0};
    int count = audio_path && strlen(audio_path) ? 2 : 1;
    int result = AVERROR_INVALIDDATA, wrote = 0, has_video=0, has_audio=0;
    if (!output_path || output_path[0] != '/') goto cleanup;
    if (open_local(video_path,&in[0]) < 0) goto cleanup;
    if (count==2 && open_local(audio_path,&in[1]) < 0) goto cleanup;
    if (avformat_alloc_output_context2(&out,NULL,mode==1?"matroska":"mp4",output_path) < 0) goto cleanup;
    for (int k=0;k<count;k++) {
        maps[k]=av_malloc_array(in[k]->nb_streams,sizeof(int));
        if (!maps[k]) goto cleanup;
        for (unsigned i=0;i<in[k]->nb_streams;i++) {
            maps[k][i]=-1;
            AVCodecParameters *p=in[k]->streams[i]->codecpar;
            int take_video=k==0 && p->codec_type==AVMEDIA_TYPE_VIDEO && !has_video;
            int take_audio=k==(count-1) && p->codec_type==AVMEDIA_TYPE_AUDIO && (count==1 || !has_audio);
            if (!take_video && !take_audio) continue;
            if (mode==0 && !mp4_codec(p->codec_id,p->codec_type)) { result=-2; goto cleanup; }
            AVStream *s=avformat_new_stream(out,NULL);
            if (!s || avcodec_parameters_copy(s->codecpar,p)<0) goto cleanup;
            s->codecpar->codec_tag=0; s->time_base=in[k]->streams[i]->time_base;
            if (mode==0 && p->codec_id==AV_CODEC_ID_HEVC) s->codecpar->codec_tag=MKTAG('h','v','c','1');
            av_dict_copy(&s->metadata,in[k]->streams[i]->metadata,0);
            maps[k][i]=s->index; has_video |= take_video; has_audio |= take_audio;
        }
        packets[k]=av_packet_alloc(); if (!packets[k]) goto cleanup;
    }
    if (!has_video || (count==2 && !has_audio)) goto cleanup;
    if (avio_open(&out->pb,output_path,AVIO_FLAG_WRITE)<0) goto cleanup;
    AVDictionary *options=NULL;
    if (mode!=1) av_dict_set(&options,"movflags","+faststart",0);
    int header=avformat_write_header(out,&options); av_dict_free(&options);
    if (header<0) goto cleanup;
    for (int k=0;k<count;k++) ready[k]=next_packet(in[k],packets[k],maps[k]);
    while (ready[0] || ready[1]) {
        if (ready[0]<0 || ready[1]<0) goto cleanup;
        int k=ready[0] ? 0 : 1;
        if (ready[0] && ready[1]) {
            int64_t a=packets[0]->dts, b=packets[1]->dts;
            if (a==AV_NOPTS_VALUE || b==AV_NOPTS_VALUE) goto cleanup;
            if (in[0]->start_time!=AV_NOPTS_VALUE) a-=av_rescale_q(in[0]->start_time,AV_TIME_BASE_Q,in[0]->streams[packets[0]->stream_index]->time_base);
            if (in[1]->start_time!=AV_NOPTS_VALUE) b-=av_rescale_q(in[1]->start_time,AV_TIME_BASE_Q,in[1]->streams[packets[1]->stream_index]->time_base);
            if (av_compare_ts(a,in[0]->streams[packets[0]->stream_index]->time_base,b,in[1]->streams[packets[1]->stream_index]->time_base)>0) k=1;
        }
        AVPacket *p=packets[k]; AVStream *s=in[k]->streams[p->stream_index];
        int dest=maps[k][p->stream_index];
        if (in[k]->start_time!=AV_NOPTS_VALUE) {
            int64_t start=av_rescale_q(in[k]->start_time,AV_TIME_BASE_Q,s->time_base);
            if (p->pts!=AV_NOPTS_VALUE) p->pts-=start;
            if (p->dts!=AV_NOPTS_VALUE) p->dts-=start;
        }
        av_packet_rescale_ts(p,s->time_base,out->streams[dest]->time_base);
        p->stream_index=dest; p->pos=-1;
        if (av_interleaved_write_frame(out,p)<0) goto cleanup;
        wrote++; ready[k]=next_packet(in[k],p,maps[k]);
    }
    if (wrote && av_write_trailer(out)>=0) result=0;
cleanup:
    for (int k=0;k<2;k++) { av_packet_free(&packets[k]); av_free(maps[k]); avformat_close_input(&in[k]); }
    if (out) { if (out->pb) avio_closep(&out->pb); avformat_free_context(out); }
    return result;
}
int harbor_transcode(const char *, const char *, const char *);
int harbor_convert(const char *video_path, const char *audio_path, const char *output_path, int mode) {
    if (mode<0 || mode>2) return AVERROR(EINVAL);
    return mode==2 ? harbor_transcode(video_path,audio_path,output_path) : remux_files(video_path,audio_path,output_path,mode);
}
int harbor_remux(const char *video_path, const char *audio_path, const char *output_path) { return harbor_convert(video_path,audio_path,output_path,0); }
static int drain(AVCodecContext *decoder, AVFrame *frame, int *frames) {
    int r;
    while ((r=avcodec_receive_frame(decoder,frame)) >= 0) { (*frames)++; av_frame_unref(frame); }
    return r == AVERROR(EAGAIN) || r == AVERROR_EOF ? 0 : r;
}
int harbor_verify(const char *path) {
    AVFormatContext *input=NULL; AVCodecContext **decoders=NULL;
    AVPacket *packet=av_packet_alloc(); AVFrame *frame=av_frame_alloc();
    int result=AVERROR_INVALIDDATA, frames=0, read_result;
    if (!packet || !frame || open_local(path,&input)<0) goto finish;
    decoders=av_calloc(input->nb_streams,sizeof(*decoders)); if (!decoders) goto finish;
    for (unsigned i=0;i<input->nb_streams;i++) {
        AVCodecParameters *p=input->streams[i]->codecpar;
        if (p->codec_type!=AVMEDIA_TYPE_VIDEO && p->codec_type!=AVMEDIA_TYPE_AUDIO) continue;
        const AVCodec *codec=p->codec_id==AV_CODEC_ID_AV1 ? avcodec_find_decoder_by_name("libdav1d") : avcodec_find_decoder(p->codec_id); if (!codec) goto finish;
        decoders[i]=avcodec_alloc_context3(codec);
        if (!decoders[i] || avcodec_parameters_to_context(decoders[i],p)<0) goto finish;
        decoders[i]->err_recognition=AV_EF_EXPLODE;
        if (avcodec_open2(decoders[i],codec,NULL)<0) goto finish;
    }
    while ((read_result=av_read_frame(input,packet))>=0) {
        AVCodecContext *d=decoders[packet->stream_index];
        if (d && (avcodec_send_packet(d,packet)<0 || drain(d,frame,&frames)<0)) goto finish;
        av_packet_unref(packet);
    }
    if (read_result!=AVERROR_EOF) goto finish;
    for (unsigned i=0;i<input->nb_streams;i++) if (decoders[i]) {
        if (avcodec_send_packet(decoders[i],NULL)<0 || drain(decoders[i],frame,&frames)<0) goto finish;
    }
    if (frames>0) result=0;
finish:
    if (decoders) { for (unsigned i=0;i<input->nb_streams;i++) avcodec_free_context(&decoders[i]); av_free(decoders); }
    avformat_close_input(&input); av_packet_free(&packet); av_frame_free(&frame); return result;
}
int harbor_decrypt(const uint8_t *input, size_t size, const uint8_t *key, const uint8_t *iv, uint8_t *output, size_t *written) {
    // Validate every PKCS7 byte explicitly, including malformed or wrong-key input.
    if (!input || !key || !iv || !output || !written || !size || size % 16) return kCCParamError;
    *written = 0;
    size_t decrypted = 0;
    CCCryptorStatus status = CCCrypt(kCCDecrypt,kCCAlgorithmAES,0,key,16,iv,input,size,output,size,&decrypted);
    if (status != kCCSuccess) return status;
    unsigned padding = output[decrypted - 1];
    if (!padding || padding > 16 || padding > decrypted) return kCCDecodeError;
    unsigned invalid = 0;
    for (unsigned i = 0; i < padding; i++) invalid |= output[decrypted - 1 - i] ^ padding;
    if (invalid) return kCCDecodeError;
    *written = decrypted - padding;
    return kCCSuccess;
}
