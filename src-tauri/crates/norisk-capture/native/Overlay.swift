import AVFoundation
import CoreImage
import CoreText

private var overlayFont: CTFont?

@_cdecl("nrc_set_overlay_font")
func setOverlayFont(_ bytes: UnsafePointer<UInt8>, _ length: Int) {
    guard let descriptor = CTFontManagerCreateFontDescriptorFromData(Data(bytes: bytes, count: length) as CFData) else { return }
    overlayFont = CTFontCreateWithFontDescriptor(descriptor, 1, nil)
}

private let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

struct PixelRect { let left: Int, top: Int, width: Int, height: Int }

struct Layer {
    let from: Double, to: Double
    let draw: (CIImage) -> CIImage
}

struct Painter {
    let width: Int, height: Int
    let blanked: [Span]
    let layers: [Layer]

    init(overlays value: Any?, blanked: [Span], width: Int, height: Int) {
        self.width = width; self.height = height; self.blanked = blanked
        let unit = Double(height) / 1080
        let scaled = { (value: Int) in max(1, Int((Double(value) * unit).rounded())) }
        layers = (value as? [[String: Any]] ?? []).compactMap { overlay in
            guard let kind = overlay["kind"] as? String, let from = overlay.number("startSeconds"), let to = overlay.number("endSeconds"),
                  let rect = pixelRect(left: overlay.number("left") ?? 0, top: overlay.number("top") ?? 0, width: overlay.number("width") ?? 0,
                                       height: overlay.number("height") ?? 0, frameWidth: width, frameHeight: height)
            else { return nil }
            let area = CGRect(x: rect.left, y: height - rect.top - rect.height, width: rect.width, height: rect.height)
            let colour = (overlay["colour"] as? NSNumber)?.uint32Value ?? 0
            switch kind {
            case "blur":
                let radius = min(64, max(1, scaled((overlay["strength"] as? NSNumber)?.intValue ?? 12)))
                return Layer(from: from, to: to) { image in
                    var blurred = image.cropped(to: area).clampedToExtent()
                    for _ in 0..<3 { blurred = blurred.applyingFilter("CIBoxBlur", parameters: [kCIInputRadiusKey: 2 * radius + 2]) }
                    return blurred.cropped(to: area).composited(over: image)
                }
            case "box":
                let fill = CIImage(color: ciColour(colour)).cropped(to: area)
                return Layer(from: from, to: to) { fill.composited(over: $0) }
            case "arrow":
                let thickness = Double(scaled((overlay["thickness"] as? NSNumber)?.intValue ?? 8))
                let alpha = arrow(columns: rect.width, rows: rect.height, thickness: thickness, towards: overlay["towards"] as? String ?? "bottom_right")
                guard let stamp = stamp(alpha, colour: colour, width: rect.width, height: rect.height, at: area) else { return nil }
                return Layer(from: from, to: to) { stamp.composited(over: $0) }
            case "text":
                guard let content = overlay["content"] as? String,
                      let image = text(content, size: scaled((overlay["size"] as? NSNumber)?.intValue ?? 48), colour: colour,
                                       align: overlay["align"] as? String ?? "center", vertical: overlay["vertical"] as? String ?? "center",
                                       width: rect.width, height: rect.height)
                else { return nil }
                let stamp = CIImage(cgImage: image).transformed(by: CGAffineTransform(translationX: area.minX, y: area.minY))
                return Layer(from: from, to: to) { stamp.composited(over: $0) }
            default:
                return nil
            }
        }
    }

    func paint(_ source: CIImage, at time: Double) -> CIImage {
        var image = blanked.contains(where: { time >= $0.from && time < $0.to })
            ? CIImage(color: .black).cropped(to: source.extent) : source
        for layer in layers where time >= layer.from && time < layer.to { image = layer.draw(image) }
        return image
    }
}

func pixelRect(left: Double, top: Double, width: Double, height: Double, frameWidth: Int, frameHeight: Int) -> PixelRect? {
    guard frameWidth > 0, frameHeight > 0 else { return nil }
    let unit = { (value: Double) in min(1, max(0, value)) }
    let x = Int((unit(left) * Double(frameWidth)).rounded(.down))
    let y = Int((unit(top) * Double(frameHeight)).rounded(.down))
    let right = min(frameWidth, Int(((unit(left) + unit(width)) * Double(frameWidth)).rounded(.up)))
    let bottom = min(frameHeight, Int(((unit(top) + unit(height)) * Double(frameHeight)).rounded(.up)))
    guard right > x, bottom > y else { return nil }
    return PixelRect(left: x, top: y, width: right - x, height: bottom - y)
}

func ciColour(_ colour: UInt32) -> CIColor {
    CIColor(red: CGFloat((colour >> 16) & 0xff) / 255, green: CGFloat((colour >> 8) & 0xff) / 255,
            blue: CGFloat(colour & 0xff) / 255, alpha: 1, colorSpace: sRGB)!
}

func stamp(_ alpha: [UInt8], colour: UInt32, width: Int, height: Int, at area: CGRect) -> CIImage? {
    let channels = [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff].map { Int($0) }
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    for (index, cover) in alpha.enumerated() where cover > 0 {
        for channel in 0..<3 { pixels[index * 4 + channel] = UInt8((channels[channel] * Int(cover) + 127) / 255) }
        pixels[index * 4 + 3] = cover
    }
    guard let provider = CGDataProvider(data: Data(pixels) as CFData),
          let image = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4, space: sRGB,
                              bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider,
                              decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    else { return nil }
    return CIImage(cgImage: image).transformed(by: CGAffineTransform(translationX: area.minX, y: area.minY))
}

private func heading(_ towards: String) -> (Int, Int) {
    switch towards {
    case "top_left": return (-1, -1)
    case "top_right": return (1, -1)
    case "bottom_left": return (-1, 1)
    case "top": return (0, -1)
    case "right": return (1, 0)
    case "bottom": return (0, 1)
    case "left": return (-1, 0)
    default: return (1, 1)
    }
}

private func ends(_ size: Double, way: Int, wing: Double) -> (Double, Double) {
    let last = size - 1
    switch way {
    case 1: return (0, max(0, last - wing))
    case -1: return (last, min(wing, last))
    default: return (last / 2, last / 2)
    }
}

func arrow(columns: Int, rows: Int, thickness: Double, towards: String) -> [UInt8] {
    let (width, height) = (Double(columns), Double(rows))
    let thickness = min(max(1, thickness), min(width, height))
    let half = thickness / 2
    let reach = min(max(min(width, height) * 0.3, thickness * 3), min(width, height) / 2)
    let wing = reach * 0.6
    let (wayX, wayY) = heading(towards)
    let (tailX, tipX) = ends(width, way: wayX, wing: wing)
    let (tailY, tipY) = ends(height, way: wayY, wing: wing)
    let (runX, runY) = (tipX - tailX, tipY - tailY)
    let length = max(1, hypot(runX, runY))
    let (unitX, unitY) = (runX / length, runY / length)
    let head = min(reach, length)
    let neck = length - head
    var alpha = [UInt8](repeating: 0, count: columns * rows)
    for y in 0..<rows {
        for x in 0..<columns {
            let alongX = Double(x) - tailX, alongY = Double(y) - tailY
            let forward = alongX * unitX + alongY * unitY
            let aside = abs(alongX * unitY - alongY * unitX)
            let shaft = (0...neck).contains(forward) ? min(1, max(0, half + 0.5 - aside)) : 0
            let back = length - forward
            let tip = (0...head).contains(back) ? min(1, max(0, back / head * wing + 0.5 - aside)) : 0
            alpha[y * columns + x] = UInt8((max(shaft, tip) * 255).rounded())
        }
    }
    return alpha
}

func text(_ content: String, size: Int, colour: UInt32, align: String, vertical: String, width: Int, height: Int) -> CGImage? {
    let content = content.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !content.isEmpty, let base = overlayFont else { return nil }
    let font = CTFontCreateCopyWithAttributes(base, CGFloat(max(1, min(512, max(4, size)))) / (CTFontGetAscent(base) + CTFontGetDescent(base)), nil, nil)
    let ascent = Double(CTFontGetAscent(font)), glyphHeight = ascent + Double(CTFontGetDescent(font))
    let lineHeight = glyphHeight + Double(CTFontGetLeading(font))
    var lines: [(glyphs: [CGGlyph], positions: [Double], width: Double)] = [([], [], 0)]
    for character in content {
        if character == "\n" || character == "\r\n" { lines.append(([], [], 0)); continue }
        var units = Array(String(character).utf16), glyphs = [CGGlyph](repeating: 0, count: units.count)
        CTFontGetGlyphsForCharacters(font, &units, &glyphs, units.count)
        var glyph = glyphs[0], advance = CGSize.zero
        CTFontGetAdvancesForGlyphs(font, .horizontal, &glyph, &advance, 1)
        if let pen = lines.last?.width, pen > 0, pen + Double(advance.width) > Double(width) { lines.append(([], [], 0)) }
        lines[lines.count - 1].glyphs.append(glyph)
        lines[lines.count - 1].positions.append(lines[lines.count - 1].width)
        lines[lines.count - 1].width += Double(advance.width)
    }
    let fitting = Int(max(0, ((Double(height) - glyphHeight) / lineHeight).rounded(.down))) + 1
    lines = Array(lines.prefix(fitting))
    let spareHeight = max(0, Double(height) - (glyphHeight + lineHeight * Double(lines.count - 1)))
    let top = vertical == "top" ? 0 : vertical == "bottom" ? spareHeight : spareHeight / 2
    guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: sRGB,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    context.setFillColor(CGColor(colorSpace: sRGB, components: [CGFloat((colour >> 16) & 0xff) / 255, CGFloat((colour >> 8) & 0xff) / 255,
                                                               CGFloat(colour & 0xff) / 255, 1])!)
    for (row, line) in lines.enumerated() {
        let spare = max(0, Double(width) - line.width)
        let offset = align == "left" ? 0 : align == "right" ? spare : spare / 2
        let baseline = Double(height) - (top + ascent + lineHeight * Double(row))
        let positions = line.positions.map { CGPoint(x: offset + $0, y: baseline) }
        CTFontDrawGlyphs(font, line.glyphs, positions, line.glyphs.count, context)
    }
    return context.makeImage()
}
