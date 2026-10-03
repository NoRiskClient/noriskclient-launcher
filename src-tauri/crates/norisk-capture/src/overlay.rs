use norisk_ipc::{ClipOverlay, Corner, OverlayKind};

const BLUR_PASSES: usize = 3;

const FONT: &[u8] = include_bytes!("../../../../public/fonts/smallcaps.ttf");
#[cfg(test)]
const NEUTRAL: u8 = 128;

static PARSED: std::sync::OnceLock<Option<ab_glyph::FontRef<'static>>> =
    std::sync::OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Channel {
    Luma,
    Blue,
    Red,
}

impl Channel {
    fn value_of(self, colour: u32) -> u8 {
        let (luma, blue, red) = to_yuv(colour);
        match self {
            Channel::Luma => luma,
            Channel::Blue => blue,
            Channel::Red => red,
        }
    }

    fn scale(self) -> f32 {
        match self {
            Channel::Luma => 1.0,
            Channel::Blue | Channel::Red => 0.5,
        }
    }
}

struct Stamp {
    alpha: Vec<u8>,
    value: u8,
}

#[derive(Default)]
pub struct Stamps {
    made: std::collections::HashMap<(usize, Channel, usize, usize), Option<Stamp>>,
}

impl Stamps {
    pub fn apply(&mut self, index: usize, plane: &mut Plane, rect: Rect, kind: &OverlayKind) {
        let Some(rect) = clamp(rect, plane.width, plane.height) else {
            return;
        };
        if let OverlayKind::Blur { strength } = kind {
            blur(plane, rect, *strength);
            return;
        }
        let stamp = self
            .made
            .entry((index, plane.channel, rect.width, rect.height))
            .or_insert_with(|| stamp_of(kind, rect.width, rect.height, plane.channel));
        if let Some(stamp) = stamp {
            press(plane, rect, stamp);
        }
    }
}

pub fn to_yuv(colour: u32) -> (u8, u8, u8) {
    let red = ((colour >> 16) & 0xff) as f32;
    let green = ((colour >> 8) & 0xff) as f32;
    let blue = (colour & 0xff) as f32;

    let luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    let studio = 16.0 + luma * 219.0 / 255.0;
    let difference_blue = 128.0 + (blue - luma) * 0.5389 * 224.0 / 255.0;
    let difference_red = 128.0 + (red - luma) * 0.6350 * 224.0 / 255.0;

    (
        studio.round().clamp(0.0, 255.0) as u8,
        difference_blue.round().clamp(0.0, 255.0) as u8,
        difference_red.round().clamp(0.0, 255.0) as u8,
    )
}

pub struct Plane<'a> {
    pub data: &'a mut [u8],
    pub stride: usize,
    pub width: usize,
    pub height: usize,
    pub channel: Channel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub left: usize,
    pub top: usize,
    pub width: usize,
    pub height: usize,
}

pub fn covers(overlay: &ClipOverlay, seconds: f64) -> bool {
    seconds >= overlay.start_seconds && seconds < overlay.end_seconds
}

pub fn rect_in(overlay: &ClipOverlay, width: usize, height: usize) -> Option<Rect> {
    if width == 0 || height == 0 {
        return None;
    }

    let clamp = |value: f32| value.clamp(0.0, 1.0) as f64;
    let left = (clamp(overlay.left) * width as f64).floor() as usize;
    let top = (clamp(overlay.top) * height as f64).floor() as usize;
    let right = ((clamp(overlay.left) + clamp(overlay.width)) * width as f64).ceil() as usize;
    let bottom = ((clamp(overlay.top) + clamp(overlay.height)) * height as f64).ceil() as usize;

    let right = right.min(width);
    let bottom = bottom.min(height);
    if right <= left || bottom <= top {
        return None;
    }

    Some(Rect {
        left,
        top,
        width: right - left,
        height: bottom - top,
    })
}

fn stamp_of(kind: &OverlayKind, width: usize, height: usize, channel: Channel) -> Option<Stamp> {
    let mut alpha = vec![0u8; width * height];
    let colour = match kind {
        OverlayKind::Blur { .. } => return None,
        OverlayKind::Box { colour } => {
            alpha.fill(u8::MAX);
            *colour
        }
        OverlayKind::Arrow {
            colour,
            thickness,
            towards,
        } => {
            arrow(&mut alpha, width, height, *thickness as f64 * channel.scale() as f64, *towards);
            *colour
        }
        OverlayKind::Text {
            content,
            size,
            colour,
        } => {
            if !text(&mut alpha, width, height, content, *size, channel.scale()) {
                return None;
            }
            *colour
        }
    };
    Some(Stamp {
        alpha,
        value: channel.value_of(colour),
    })
}

fn press(plane: &mut Plane, rect: Rect, stamp: &Stamp) {
    let value = stamp.value as u32;
    for y in 0..rect.height {
        let start = (rect.top + y) * plane.stride + rect.left;
        let row = &mut plane.data[start..start + rect.width];
        let cover = &stamp.alpha[y * rect.width..(y + 1) * rect.width];
        for (slot, &alpha) in row.iter_mut().zip(cover) {
            match alpha {
                0 => {}
                u8::MAX => *slot = stamp.value,
                alpha => {
                    let alpha = alpha as u32;
                    *slot = ((*slot as u32 * (255 - alpha) + value * alpha + 127) / 255) as u8;
                }
            }
        }
    }
}

fn text(alpha: &mut [u8], width: usize, height: usize, content: &str, size: u32, scale: f32) -> bool {
    use ab_glyph::{Font, ScaleFont};

    let Some(font) = PARSED
        .get_or_init(|| ab_glyph::FontRef::try_from_slice(FONT).ok())
        .as_ref()
    else {
        log::error!("The bundled font could not be read, so text overlays are skipped");
        return false;
    };

    let content = content.trim();
    if content.is_empty() {
        return false;
    }

    let scaled = font.as_scaled(ab_glyph::PxScale::from(
        (size.clamp(4, 512) as f32 * scale).max(1.0),
    ));
    let line_height = scaled.height() + scaled.line_gap();

    let mut pen_x = 0.0f32;
    let mut baseline = scaled.ascent();

    for character in content.chars() {
        if character == '\n' {
            pen_x = 0.0;
            baseline += line_height;
            continue;
        }

        let glyph_id = font.glyph_id(character);
        let advance = scaled.h_advance(glyph_id);

        if pen_x + advance > width as f32 && pen_x > 0.0 {
            pen_x = 0.0;
            baseline += line_height;
        }
        if baseline - scaled.descent() > height as f32 {
            break;
        }

        let glyph = glyph_id.with_scale_and_position(
            scaled.scale(),
            ab_glyph::point(pen_x, baseline),
        );
        if let Some(outline) = font.outline_glyph(glyph) {
            let bounds = outline.px_bounds();
            outline.draw(|x, y, coverage| {
                let at_x = bounds.min.x as i64 + x as i64;
                let at_y = bounds.min.y as i64 + y as i64;
                if at_x < 0 || at_y < 0 {
                    return;
                }
                let (at_x, at_y) = (at_x as usize, at_y as usize);
                if at_x >= width || at_y >= height {
                    return;
                }
                let slot = &mut alpha[at_y * width + at_x];
                let cover = (coverage.clamp(0.0, 1.0) * 255.0).round() as u8;
                *slot = (*slot).max(cover);
            });
        }

        pen_x += advance;
    }
    true
}

const ARROW_HEAD_SHARE: f64 = 0.3;
const ARROW_HEAD_PER_THICKNESS: f64 = 3.0;
const ARROW_WING_SHARE: f64 = 0.6;

fn arrow(alpha: &mut [u8], columns: usize, rows: usize, thickness: f64, towards: Corner) {
    let (width, height) = (columns as f64, rows as f64);
    let flip_x = matches!(towards, Corner::TopLeft | Corner::BottomLeft);
    let flip_y = matches!(towards, Corner::TopLeft | Corner::TopRight);

    let thickness = thickness.max(1.0).min(width.min(height));
    let half = thickness / 2.0;
    let head = (width.min(height) * ARROW_HEAD_SHARE)
        .max(thickness * ARROW_HEAD_PER_THICKNESS)
        .min(width.min(height) / 2.0);
    let wing = head * ARROW_WING_SHARE;

    let (run_x, run_y) = ((width - 1.0 - wing).max(0.0), (height - 1.0 - wing).max(0.0));
    let length = run_x.hypot(run_y).max(1.0);
    let (unit_x, unit_y) = (run_x / length, run_y / length);
    let head = head.min(length);
    let neck = length - head;

    for y in 0..rows {
        for x in 0..columns {
            let along_x = if flip_x { width - 1.0 - x as f64 } else { x as f64 };
            let along_y = if flip_y { height - 1.0 - y as f64 } else { y as f64 };

            let forward = along_x * unit_x + along_y * unit_y;
            let aside = (along_x * unit_y - along_y * unit_x).abs();

            let shaft = if (0.0..=neck).contains(&forward) {
                (half + 0.5 - aside).clamp(0.0, 1.0)
            } else {
                0.0
            };

            let back = length - forward;
            let tip = if (0.0..=head).contains(&back) {
                (back / head * wing + 0.5 - aside).clamp(0.0, 1.0)
            } else {
                0.0
            };

            let cover = (shaft.max(tip) * 255.0).round() as u8;
            let slot = &mut alpha[y * columns + x];
            *slot = (*slot).max(cover);
        }
    }
}

fn clamp(rect: Rect, width: usize, height: usize) -> Option<Rect> {
    let left = rect.left.min(width);
    let top = rect.top.min(height);
    let right = (rect.left + rect.width).min(width);
    let bottom = (rect.top + rect.height).min(height);
    if right <= left || bottom <= top {
        return None;
    }
    Some(Rect {
        left,
        top,
        width: right - left,
        height: bottom - top,
    })
}

fn blur(plane: &mut Plane, rect: Rect, strength: u32) {
    let radius = ((strength.clamp(1, 64) as f32 * plane.channel.scale()) as usize).max(1);
    if rect.width == 0 || rect.height == 0 {
        return;
    }

    let mut prefix = Vec::with_capacity(rect.width.max(rect.height) + 1);
    let mut column = vec![0u8; rect.height];
    for _ in 0..BLUR_PASSES {
        for y in rect.top..rect.top + rect.height {
            let start = y * plane.stride + rect.left;
            smear(&mut plane.data[start..start + rect.width], radius, &mut prefix);
        }

        for x in rect.left..rect.left + rect.width {
            for (index, slot) in column.iter_mut().enumerate() {
                *slot = plane.data[(rect.top + index) * plane.stride + x];
            }
            smear(&mut column, radius, &mut prefix);
            for (index, value) in column.iter().enumerate() {
                plane.data[(rect.top + index) * plane.stride + x] = *value;
            }
        }
    }
}

fn smear(line: &mut [u8], radius: usize, prefix: &mut Vec<u32>) {
    prefix.clear();
    prefix.push(0);
    let mut total = 0u32;
    for value in line.iter() {
        total += *value as u32;
        prefix.push(total);
    }

    let length = line.len();
    for (x, slot) in line.iter_mut().enumerate() {
        let from = x.saturating_sub(radius);
        let to = (x + radius + 1).min(length);
        *slot = ((prefix[to] - prefix[from]) / (to - from) as u32) as u8;
    }
}

pub fn halve(rect: Rect, width: usize, height: usize) -> Rect {
    let left = (rect.left / 2).min(width);
    let top = (rect.top / 2).min(height);
    let right = (rect.left + rect.width).div_ceil(2).min(width);
    let bottom = (rect.top + rect.height).div_ceil(2).min(height);
    Rect {
        left,
        top,
        width: right.saturating_sub(left),
        height: bottom.saturating_sub(top),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn overlay(left: f32, top: f32, width: f32, height: f32) -> ClipOverlay {
        ClipOverlay {
            kind: OverlayKind::Blur { strength: 8 },
            left,
            top,
            width,
            height,
            start_seconds: 1.0,
            end_seconds: 3.0,
        }
    }

    fn checkerboard(width: usize, height: usize) -> Vec<u8> {
        (0..width * height)
            .map(|i| if (i / 4 + i / (width * 4)) % 2 == 0 { 20 } else { 235 })
            .collect()
    }

    fn spread(data: &[u8], stride: usize, rect: Rect) -> f64 {
        let mut values = Vec::new();
        for y in rect.top..rect.top + rect.height {
            for x in rect.left..rect.left + rect.width {
                values.push(data[y * stride + x] as f64);
            }
        }
        let mean = values.iter().sum::<f64>() / values.len() as f64;
        (values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / values.len() as f64).sqrt()
    }

    #[test]
    fn an_overlay_only_covers_its_own_stretch_of_time() {
        let one = overlay(0.0, 0.0, 1.0, 1.0);
        assert!(!covers(&one, 0.99));
        assert!(covers(&one, 1.0));
        assert!(covers(&one, 2.5));
        assert!(!covers(&one, 3.0), "the end is exclusive");
        assert!(!covers(&one, 9.0));
    }

    #[test]
    fn a_fraction_of_the_frame_becomes_whole_pixels() {
        let rect = rect_in(&overlay(0.25, 0.5, 0.5, 0.25), 1920, 1080).unwrap();
        assert_eq!(rect.left, 480);
        assert_eq!(rect.top, 540);
        assert_eq!(rect.width, 960);
        assert_eq!(rect.height, 270);
    }

    #[test]
    fn an_overlay_hanging_over_the_edge_is_cut_to_the_frame() {
        let rect = rect_in(&overlay(0.8, 0.8, 0.5, 0.5), 100, 100).unwrap();
        assert_eq!(rect.left, 80);
        assert_eq!(rect.top, 80);
        assert_eq!(rect.left + rect.width, 100);
        assert_eq!(rect.top + rect.height, 100);
    }

    #[test]
    fn an_empty_or_backwards_overlay_is_dropped() {
        assert!(rect_in(&overlay(0.5, 0.5, 0.0, 0.5), 100, 100).is_none());
        assert!(rect_in(&overlay(0.5, 0.5, 0.5, 0.0), 100, 100).is_none());
        assert!(rect_in(&overlay(0.2, 0.2, 0.5, 0.5), 0, 100).is_none());
    }

    #[test]
    fn blurring_flattens_the_detail_it_covers() {
        let (width, height) = (64, 64);
        let mut data = checkerboard(width, height);
        let rect = Rect { left: 16, top: 16, width: 32, height: 32 };

        let before = spread(&data, width, rect);
        let mut plane = Plane { data: &mut data, stride: width, width, height, channel: Channel::Luma };
        Stamps::default().apply(0, &mut plane, rect, &OverlayKind::Blur { strength: 6 });
        let after = spread(&data, width, rect);

        assert!(
            after < before / 4.0,
            "detail survived: {before:.1} before, {after:.1} after",
        );
    }

    fn blur_the_slow_way(data: &mut [u8], stride: usize, rect: Rect, radius: usize) {
        let mut row = vec![0u8; rect.width];
        let mut column = vec![0u8; rect.height];
        for _ in 0..BLUR_PASSES {
            for y in rect.top..rect.top + rect.height {
                let start = y * stride + rect.left;
                row.copy_from_slice(&data[start..start + rect.width]);
                for x in 0..rect.width {
                    let from = x.saturating_sub(radius);
                    let to = (x + radius + 1).min(rect.width);
                    let sum: u32 = row[from..to].iter().map(|v| *v as u32).sum();
                    data[start + x] = (sum / (to - from) as u32) as u8;
                }
            }
            for x in rect.left..rect.left + rect.width {
                for (index, slot) in column.iter_mut().enumerate() {
                    *slot = data[(rect.top + index) * stride + x];
                }
                for y in 0..rect.height {
                    let from = y.saturating_sub(radius);
                    let to = (y + radius + 1).min(rect.height);
                    let sum: u32 = column[from..to].iter().map(|v| *v as u32).sum();
                    data[(rect.top + y) * stride + x] = (sum / (to - from) as u32) as u8;
                }
            }
        }
    }

    #[test]
    fn the_running_sum_blur_matches_the_straightforward_one_pixel_for_pixel() {
        let (width, height, stride) = (57, 41, 64);
        let mut seed = 0x9E37_79B9_7F4A_7C15u64;
        let noise: Vec<u8> = (0..stride * height)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                (seed >> 56) as u8
            })
            .collect();

        for strength in [1, 2, 5, 12, 30, 64] {
            for rect in [
                Rect { left: 0, top: 0, width, height },
                Rect { left: 3, top: 7, width: 20, height: 9 },
                Rect { left: 50, top: 30, width: 7, height: 11 },
            ] {
                let mut fast = noise.clone();
                let mut plane = Plane {
                    data: &mut fast,
                    stride,
                    width,
                    height,
                    channel: Channel::Luma,
                };
                Stamps::default().apply(0, &mut plane, rect, &OverlayKind::Blur { strength });

                let mut slow = noise.clone();
                blur_the_slow_way(&mut slow, stride, rect, strength as usize);

                assert_eq!(fast, slow, "strength {strength}, {rect:?} came out different");
            }
        }
    }

    #[test]
    fn a_kept_stamp_draws_exactly_what_a_fresh_one_draws_frame_after_frame() {
        let (width, height) = (96, 64);
        let rect = Rect { left: 10, top: 8, width: 70, height: 40 };
        let kinds = [
            OverlayKind::Box { colour: 0xff3b30 },
            OverlayKind::Arrow { colour: 0x0a84ff, thickness: 4, towards: Corner::TopRight },
            OverlayKind::Text { content: "CLIP".into(), size: 28, colour: 0xffcc00 },
        ];

        for kind in kinds {
            let mut stamps = Stamps::default();
            for frame in 0..4u64 {
                let mut seed = 0x2545_F491_4F6C_DD1D ^ (frame + 1);
                let picture: Vec<u8> = (0..width * height)
                    .map(|_| {
                        seed ^= seed << 13;
                        seed ^= seed >> 7;
                        seed ^= seed << 17;
                        (seed >> 56) as u8
                    })
                    .collect();

                let mut kept = picture.clone();
                let mut plane = Plane {
                    data: &mut kept,
                    stride: width,
                    width,
                    height,
                    channel: Channel::Luma,
                };
                stamps.apply(0, &mut plane, rect, &kind);

                let mut fresh = picture.clone();
                let mut plane = Plane {
                    data: &mut fresh,
                    stride: width,
                    width,
                    height,
                    channel: Channel::Luma,
                };
                Stamps::default().apply(0, &mut plane, rect, &kind);

                assert_eq!(kept, fresh, "{kind:?} drifted on frame {frame}");
            }
        }
    }

    #[test]
    fn blurring_leaves_everything_outside_the_rectangle_alone() {
        let (width, height) = (64, 64);
        let original = checkerboard(width, height);
        let mut data = original.clone();
        let rect = Rect { left: 16, top: 16, width: 32, height: 32 };

        let mut plane = Plane { data: &mut data, stride: width, width, height, channel: Channel::Luma };
        Stamps::default().apply(0, &mut plane, rect, &OverlayKind::Blur { strength: 6 });

        for y in 0..height {
            for x in 0..width {
                let inside = x >= rect.left
                    && x < rect.left + rect.width
                    && y >= rect.top
                    && y < rect.top + rect.height;
                if !inside {
                    assert_eq!(
                        data[y * width + x],
                        original[y * width + x],
                        "pixel {x},{y} outside the rectangle changed",
                    );
                }
            }
        }
    }

    #[test]
    fn blurring_reads_rows_at_the_stride_not_the_width() {
        let (width, height, stride) = (32, 32, 48);
        let mut data = vec![7u8; stride * height];
        for y in 0..height {
            for x in 0..width {
                data[y * stride + x] = if x % 2 == 0 { 0 } else { 255 };
            }
        }

        let rect = Rect { left: 4, top: 4, width: 16, height: 16 };
        let mut plane = Plane { data: &mut data, stride, width, height, channel: Channel::Luma };
        Stamps::default().apply(0, &mut plane, rect, &OverlayKind::Blur { strength: 4 });

        for y in 0..height {
            for x in width..stride {
                assert_eq!(data[y * stride + x], 7, "padding at {x},{y} was touched");
            }
        }
    }

    #[test]
    fn a_blurred_average_stays_inside_the_range_it_came_from() {
        let (width, height) = (32, 32);
        let mut data = vec![0u8; width * height];
        for value in data.iter_mut() {
            *value = 200;
        }
        let rect = Rect { left: 0, top: 0, width, height };

        let mut plane = Plane { data: &mut data, stride: width, width, height, channel: Channel::Luma };
        Stamps::default().apply(0, &mut plane, rect, &OverlayKind::Blur { strength: 10 });

        assert!(data.iter().all(|v| *v == 200), "a flat area changed value");
    }

    #[test]
    fn a_box_paints_its_rectangle_flat_and_nothing_else() {
        let (width, height) = (32, 32);
        let original = checkerboard(width, height);
        let mut data = original.clone();
        let rect = Rect { left: 8, top: 8, width: 10, height: 6 };

        let mut plane = Plane { data: &mut data, stride: width, width, height, channel: Channel::Luma };
        Stamps::default().apply(0, &mut plane, rect, &OverlayKind::Box { colour: 0x000000 });

        for y in rect.top..rect.top + rect.height {
            for x in rect.left..rect.left + rect.width {
                assert_eq!(data[y * width + x], 16, "pixel {x},{y} was not filled");
            }
        }
        assert_eq!(data[0], original[0], "a pixel outside the box changed");
        assert_eq!(data[width * 31 + 31], original[width * 31 + 31]);
    }

    #[test]
    fn a_box_stays_inside_a_padded_plane() {
        let (width, height, stride) = (16, 16, 24);
        let mut data = vec![9u8; stride * height];
        let rect = Rect { left: 2, top: 2, width: 12, height: 12 };

        let mut plane = Plane { data: &mut data, stride, width, height, channel: Channel::Luma };
        Stamps::default().apply(0, &mut plane, rect, &OverlayKind::Box { colour: 0x646464 });

        for y in 0..height {
            for x in width..stride {
                assert_eq!(data[y * stride + x], 9, "padding at {x},{y} was filled");
            }
        }
    }

    #[test]
    fn an_arrow_never_writes_outside_its_rectangle() {
        let (width, height) = (40, 40);
        let original = vec![5u8; width * height];
        let mut data = original.clone();
        let rect = Rect { left: 10, top: 10, width: 20, height: 20 };

        let mut plane = Plane { data: &mut data, stride: width, width, height, channel: Channel::Luma };
        Stamps::default().apply(
            0,
            &mut plane,
            rect,
            &OverlayKind::Arrow { colour: 0xc8c8c8, thickness: 5, towards: Corner::TopLeft },
        );

        for y in 0..height {
            for x in 0..width {
                let inside = x >= rect.left
                    && x < rect.left + rect.width
                    && y >= rect.top
                    && y < rect.top + rect.height;
                if !inside {
                    assert_eq!(data[y * width + x], 5, "pixel {x},{y} outside was written");
                }
            }
        }
    }

    #[test]
    fn a_box_on_a_colour_plane_goes_neutral_instead_of_tinting() {
        let (width, height) = (16, 16);
        let mut data = vec![90u8; width * height];
        let rect = Rect { left: 0, top: 0, width, height };

        let mut plane = Plane {
            data: &mut data,
            stride: width,
            width,
            height,
            channel: Channel::Blue,
        };
        Stamps::default().apply(0, &mut plane, rect, &OverlayKind::Box { colour: 0x000000 });

        let (_, blue, _) = to_yuv(0x000000);
        assert_eq!(blue, NEUTRAL, "black should carry no colour");
        assert!(
            data.iter().all(|v| *v == blue),
            "a black box did not land on the neutral colour value",
        );
    }

    #[test]
    fn an_arrow_on_a_colour_plane_goes_neutral_too() {
        let (width, height) = (24, 24);
        let mut data = vec![90u8; width * height];
        let rect = Rect { left: 0, top: 0, width, height };

        let mut plane = Plane {
            data: &mut data,
            stride: width,
            width,
            height,
            channel: Channel::Blue,
        };
        Stamps::default().apply(
            0,
            &mut plane,
            rect,
            &OverlayKind::Arrow { colour: 0xffffff, thickness: 3, towards: Corner::BottomRight },
        );

        let (_, blue, _) = to_yuv(0xffffff);
        assert!(
            data.iter().all(|v| (90.min(blue)..=90.max(blue)).contains(v)),
            "the arrow wrote something other than a blend towards its own colour",
        );
        assert!(data.iter().any(|v| *v == blue), "the arrow drew nothing");
    }

    #[test]
    fn text_marks_the_picture_and_stays_in_its_box() {
        let (width, height) = (200, 80);
        let original = vec![40u8; width * height];
        let mut data = original.clone();
        let rect = Rect { left: 10, top: 10, width: 150, height: 50 };

        let mut plane = Plane {
            data: &mut data,
            stride: width,
            width,
            height,
            channel: Channel::Luma,
        };
        Stamps::default().apply(
            0,
            &mut plane,
            rect,
            &OverlayKind::Text { content: "HALLO".into(), size: 32, colour: 0xffffff },
        );

        let changed = data.iter().zip(&original).filter(|(a, b)| a != b).count();
        assert!(changed > 50, "text drew almost nothing ({changed} pixels)");

        for y in 0..height {
            for x in 0..width {
                let inside = x >= rect.left
                    && x < rect.left + rect.width
                    && y >= rect.top
                    && y < rect.top + rect.height;
                if !inside {
                    assert_eq!(
                        data[y * width + x],
                        original[y * width + x],
                        "text spilled outside its box at {x},{y}",
                    );
                }
            }
        }
    }

    #[test]
    fn empty_text_changes_nothing() {
        let (width, height) = (64, 32);
        let original = vec![40u8; width * height];
        let mut data = original.clone();

        let mut plane = Plane {
            data: &mut data,
            stride: width,
            width,
            height,
            channel: Channel::Luma,
        };
        Stamps::default().apply(
            0,
            &mut plane,
            Rect { left: 0, top: 0, width, height },
            &OverlayKind::Text { content: "   ".into(), size: 20, colour: 0xffffff },
        );

        assert_eq!(data, original);
    }

    #[test]
    fn the_bundled_font_can_actually_be_read() {
        assert!(
            PARSED
                .get_or_init(|| ab_glyph::FontRef::try_from_slice(FONT).ok())
                .is_some(),
            "the font shipped with the engine did not parse",
        );
    }

    #[test]
    fn a_halved_rectangle_stays_inside_the_chroma_plane() {
        let chroma = halve(Rect { left: 1910, top: 1070, width: 11, height: 11 }, 960, 540);
        assert_eq!(chroma.left + chroma.width, 960);
        assert_eq!(chroma.top + chroma.height, 540);

        let outside = halve(Rect { left: 4000, top: 4000, width: 8, height: 8 }, 960, 540);
        assert_eq!((outside.width, outside.height), (0, 0));
    }

    #[test]
    fn a_rectangle_reaching_past_the_plane_is_cut_to_it_instead_of_panicking() {
        let (width, height) = (32, 32);
        let mut data = checkerboard(width, height);
        let rect = Rect { left: 24, top: 24, width: 99, height: 99 };

        let mut plane = Plane { data: &mut data, stride: width, width, height, channel: Channel::Luma };
        Stamps::default().apply(0, &mut plane, rect, &OverlayKind::Blur { strength: 4 });

        assert_eq!(data.len(), width * height);
    }

    #[test]
    fn a_rectangle_wholly_outside_the_plane_does_nothing() {
        let (width, height) = (32, 32);
        let original = checkerboard(width, height);
        let mut data = original.clone();
        let rect = Rect { left: 40, top: 40, width: 8, height: 8 };

        let mut plane = Plane { data: &mut data, stride: width, width, height, channel: Channel::Luma };
        Stamps::default().apply(0, &mut plane, rect, &OverlayKind::Blur { strength: 4 });

        assert_eq!(data, original);
    }

    #[test]
    fn a_thin_rectangle_never_halves_away_to_nothing() {
        let chroma = halve(Rect { left: 0, top: 0, width: 1, height: 1 }, 10, 10);
        assert!(chroma.width >= 1 && chroma.height >= 1);
    }
}
