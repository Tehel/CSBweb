/**
 * Export graphics as PNG files for inspection
 *
 * Exports specific graphics to PNG so we can visually identify them
 */

import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { createCanvas, ImageData } from 'canvas';
import type { Palette } from '../src/core/types';

async function exportGraphics() {
    console.log('Loading graphics.dat...\n');

    const fs = await import('fs/promises');
    const path = await import('path');

    const filePath = path.join(process.cwd(), 'static/gamefiles/graphics.dat');
    const fileData = await fs.readFile(filePath);

    const loader = new GraphicsLoader();
    loader.loadFromArray(new Uint8Array(fileData));

    // Create output directory
    const outputDir = path.join(process.cwd(), 'tools/output');
    await fs.mkdir(outputDir, { recursive: true });

    // Export interesting ranges
    const ranges = [
        { start: 69, end: 120, name: 'walls' },       // Likely wall graphics (tall aspect ratios)
        { start: 0, end: 20, name: 'viewport' },      // Viewport-sized graphics
        { start: 121, end: 140, name: 'objects' },    // Object graphics
    ];

    const palette = loader.getPalette(0);

    for (const range of ranges) {
        console.log(`\nExporting ${range.name} (${range.start}-${range.end})...`);

        for (let i = range.start; i <= range.end && i < loader.getItemCount(); i++) {
            try {
                const image = loader.getImage(i);

                // Create canvas
                const canvas = createCanvas(image.width, image.height);
                const ctx = canvas.getContext('2d');

                // Convert to RGBA manually
                const rgba = new Uint8ClampedArray(image.width * image.height * 4);
                for (let i = 0; i < image.pixels.length; i++) {
                    const colorIndex = image.pixels[i];
                    const color = palette[colorIndex];

                    // Convert Atari ST color (0RGB, 4 bits per channel) to RGBA
                    const r = ((color >> 8) & 0x7) * 36;
                    const g = ((color >> 4) & 0x7) * 36;
                    const b = (color & 0x7) * 36;

                    rgba[i * 4 + 0] = r;
                    rgba[i * 4 + 1] = g;
                    rgba[i * 4 + 2] = b;
                    rgba[i * 4 + 3] = 255; // Opaque
                }

                const imageData = new ImageData(rgba, image.width, image.height);

                // Draw to canvas
                ctx.putImageData(imageData, 0, 0);

                // Save as PNG
                const fileName = `${range.name}_${i.toString().padStart(3, '0')}_${image.width}x${image.height}.png`;
                const buffer = canvas.toBuffer('image/png');
                await fs.writeFile(path.join(outputDir, fileName), buffer);

                console.log(`  Exported #${i}: ${image.width}×${image.height} -> ${fileName}`);
            } catch (error) {
                console.log(`  ERROR #${i}: ${(error as Error).message}`);
            }
        }
    }

    console.log(`\nDone! Check tools/output/ directory`);
}

exportGraphics().catch(console.error);
