// swiftc -O tools/ocr-imyong.swift -o /path/to/ocr-imyong
// ocr-imyong original.pdf lines.json
import Foundation
import PDFKit
import Vision
import AppKit

guard CommandLine.arguments.count == 3,
      let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else { exit(2) }
var pages: [[[String: Any]]] = []
for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else { exit(3) }
    let box = page.bounds(for: .mediaBox)
    let scale: CGFloat = 2.5
    guard let context = CGContext(data: nil, width: Int(box.width * scale), height: Int(box.height * scale),
            bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { exit(4) }
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: context.width, height: context.height))
    context.scaleBy(x: scale, y: scale)
    context.translateBy(x: -box.origin.x, y: -box.origin.y)
    page.draw(with: .mediaBox, to: context)
    guard let image = context.makeImage() else { exit(5) }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["ko-KR", "en-US"]
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: image).perform([request])
    let lines: [[String: Any]] = (request.results ?? []).compactMap { observation in
        guard let text = observation.topCandidates(1).first else { return nil }
        let r = observation.boundingBox
        return ["text": text.string, "box": [r.minX * box.width, (1 - r.maxY) * box.height,
            r.maxX * box.width, (1 - r.minY) * box.height], "confidence": text.confidence]
    }
    pages.append(lines)
}
try JSONSerialization.data(withJSONObject: pages).write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
