#ifndef HARBOR_MEDIA_H
#define HARBOR_MEDIA_H
#include <stddef.h>
#include <stdint.h>
// 1: accepted, 0: unable to determine, -2: unsupported codecs.
int harbor_probe(const char *path, int require_video, int require_audio);
// 0: complete; negative: media error. Only local files are accepted.
int harbor_remux(const char *video_path, const char *audio_path, const char *output_path);
int harbor_verify(const char *path);
int harbor_decrypt(const uint8_t *input, size_t size, const uint8_t *key, const uint8_t *iv, uint8_t *output, size_t *written);
#endif
