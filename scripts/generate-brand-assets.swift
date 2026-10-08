#!/usr/bin/env swift
// One vector geometry for the Learning Lab ll• mark and all installation sizes.
// Run from the repository root: swift scripts/generate-brand-assets.swift
import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let web = root.appendingPathComponent("pwa/public")
let background = "#f6f7f9", ink = "#24262b", border = "#e0e3e8"
let geometry = """
<rect x="8" y="8" width="496" height="496" rx="144" fill="\(background)" stroke="\(border)" stroke-width="12"/>
<path d="M154 148V348 M230 148V348" fill="none" stroke="\(ink)" stroke-width="28"/>
<circle cx="324" cy="334" r="24" fill="\(ink)"/>
"""
try "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\">\(geometry)</svg>\n".write(to: web.appendingPathComponent("logo.svg"), atomically: true, encoding: .utf8)
func color(_ hex: UInt32) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 255)/255, green: CGFloat((hex >> 8) & 255)/255, blue: CGFloat(hex & 255)/255, alpha: 1)
}
for (name, size) in [("logo",1024),("logo-128",128),("favicon-32",32),("icon-192",192),("icon-512",512),("icon-1024",1024),("apple-touch-icon",180)] {
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.scaleBy(x: CGFloat(size)/512, y: CGFloat(size)/512)
    // Installation icons need an opaque canvas; the web SVG keeps its rounded outline.
    context.setFillColor(color(0xf6f7f9)); context.fill(CGRect(x: 0,y: 0,width: 512,height: 512))
    context.translateBy(x: 0, y: 512); context.scaleBy(x: 1, y: -1)
    context.setStrokeColor(color(0xe0e3e8)); context.setLineWidth(12)
    context.addPath(CGPath(roundedRect: CGRect(x:8,y:8,width:496,height:496), cornerWidth:144, cornerHeight:144, transform:nil)); context.strokePath()
    context.setStrokeColor(color(0x24262b)); context.setLineWidth(28)
    for x in [154,230] { context.move(to:CGPoint(x:x,y:148)); context.addLine(to:CGPoint(x:x,y:348)); context.strokePath() }
    context.setFillColor(color(0x24262b)); context.fillEllipse(in:CGRect(x:300,y:310,width:48,height:48))
    let bitmap = NSBitmapImageRep(cgImage:context.makeImage()!)
    try bitmap.representation(using:.png,properties:[:])!.write(to:web.appendingPathComponent("\(name).png"))
}
let native = root.appendingPathComponent("macos/App/Resources")
if FileManager.default.fileExists(atPath:native.path) {
    for name in ["logo.png","logo-128.png","icon-512.png","icon-1024.png"] {
        let target = native.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath:target.path) { try FileManager.default.removeItem(at:target) }
        try FileManager.default.copyItem(at:web.appendingPathComponent(name),to:target)
    }
}
print("Generated web and native ll• assets")
