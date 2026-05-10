// nef-thumb.cpp — Render a RAW file (NEF etc.) to JPEG on stdout.
// Usage: nef-thumb <input.nef> [max_dimension]
// Output: JPEG bytes written to stdout; exit 0 on success, non-zero on error.
//
// Compile:
//   g++ -O2 -o nef-thumb nef-thumb.cpp -lraw -ljpeg
//
// LibRaw performs a full dcraw-compatible render (demosaic, white balance,
// colour space conversion to sRGB) before we compress to JPEG.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <jpeglib.h>
#include <libraw/libraw.h>

static int write_jpeg(libraw_processed_image_t *img, int max_dim) {
    if (img->type != LIBRAW_IMAGE_BITMAP) {
        fprintf(stderr, "nef-thumb: unexpected image type %d\n", img->type);
        return 1;
    }
    if (img->colors != 3) {
        fprintf(stderr, "nef-thumb: expected 3-channel image, got %d\n", img->colors);
        return 1;
    }

    unsigned int src_w = img->width;
    unsigned int src_h = img->height;
    unsigned char *src  = img->data;

    // Optionally downscale to max_dim (maintain aspect ratio)
    unsigned int dst_w = src_w, dst_h = src_h;
    if (max_dim > 0 && (src_w > (unsigned)max_dim || src_h > (unsigned)max_dim)) {
        if (src_w >= src_h) {
            dst_w = max_dim;
            dst_h = (unsigned int)((double)src_h * max_dim / src_w + 0.5);
        } else {
            dst_h = max_dim;
            dst_w = (unsigned int)((double)src_w * max_dim / src_h + 0.5);
        }
        if (dst_w < 1) dst_w = 1;
        if (dst_h < 1) dst_h = 1;
    }

    // Allocate scaled buffer if needed
    unsigned char *buf = src;
    unsigned char *alloc_buf = NULL;
    if (dst_w != src_w || dst_h != src_h) {
        alloc_buf = (unsigned char *)malloc(dst_w * dst_h * 3);
        if (!alloc_buf) { fprintf(stderr, "nef-thumb: out of memory\n"); return 1; }
        for (unsigned int dy = 0; dy < dst_h; dy++) {
            unsigned int sy = (unsigned int)((double)dy * src_h / dst_h);
            if (sy >= src_h) sy = src_h - 1;
            for (unsigned int dx = 0; dx < dst_w; dx++) {
                unsigned int sx = (unsigned int)((double)dx * src_w / dst_w);
                if (sx >= src_w) sx = src_w - 1;
                unsigned char *d = alloc_buf + (dy * dst_w + dx) * 3;
                unsigned char *s2 = src + (sy * src_w + sx) * 3;
                d[0] = s2[0]; d[1] = s2[1]; d[2] = s2[2];
            }
        }
        buf = alloc_buf;
    }

    // Encode JPEG to stdout
    struct jpeg_compress_struct cinfo;
    struct jpeg_error_mgr jerr;
    cinfo.err = jpeg_std_error(&jerr);
    jpeg_create_compress(&cinfo);
    jpeg_stdio_dest(&cinfo, stdout);

    cinfo.image_width      = dst_w;
    cinfo.image_height     = dst_h;
    cinfo.input_components = 3;
    cinfo.in_color_space   = JCS_RGB;
    jpeg_set_defaults(&cinfo);
    jpeg_set_quality(&cinfo, 88, TRUE);

    jpeg_start_compress(&cinfo, TRUE);
    while (cinfo.next_scanline < cinfo.image_height) {
        JSAMPROW row = buf + cinfo.next_scanline * dst_w * 3;
        jpeg_write_scanlines(&cinfo, &row, 1);
    }
    jpeg_finish_compress(&cinfo);
    jpeg_destroy_compress(&cinfo);

    if (alloc_buf) free(alloc_buf);
    return 0;
}

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: nef-thumb <file.nef> [max_dimension]\n");
        return 1;
    }

    int max_dim = 0;
    if (argc >= 3) max_dim = atoi(argv[2]);

    LibRaw proc;

    // Rendering params: sRGB, 8-bit, auto white balance, half-size for speed
    proc.imgdata.params.output_color  = 1;   // sRGB
    proc.imgdata.params.output_bps    = 8;   // 8-bit
    proc.imgdata.params.use_auto_wb   = 1;   // camera auto WB
    proc.imgdata.params.no_auto_bright = 0;  // allow auto brightness
    proc.imgdata.params.half_size     = 1;   // 2x faster, still plenty of res

    int ret;
    if ((ret = proc.open_file(argv[1])) != LIBRAW_SUCCESS) {
        fprintf(stderr, "nef-thumb: open_file failed: %s\n", libraw_strerror(ret));
        return 1;
    }
    if ((ret = proc.unpack()) != LIBRAW_SUCCESS) {
        fprintf(stderr, "nef-thumb: unpack failed: %s\n", libraw_strerror(ret));
        return 1;
    }
    if ((ret = proc.dcraw_process()) != LIBRAW_SUCCESS) {
        fprintf(stderr, "nef-thumb: dcraw_process failed: %s\n", libraw_strerror(ret));
        return 1;
    }

    libraw_processed_image_t *img = proc.dcraw_make_mem_image(&ret);
    if (!img) {
        fprintf(stderr, "nef-thumb: dcraw_make_mem_image failed: %s\n", libraw_strerror(ret));
        return 1;
    }

    int rc = write_jpeg(img, max_dim);
    LibRaw::dcraw_clear_mem(img);
    return rc;
}
