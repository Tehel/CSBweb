/**
 * Graphics inspector tool
 *
 * Loads graphics.dat and displays information about all graphics:
 * - Index, dimensions, compressed/decompressed sizes
 * - Helps identify which graphics are walls, floors, objects, etc.
 */

import { GraphicsLoader } from '../src/data/GraphicsLoader';

async function inspectGraphics() {
    console.log('Loading graphics.dat...\n');

    const fs = await import('fs/promises');
    const path = await import('path');

    const filePath = path.join(process.cwd(), 'static/gamefiles/graphics.dat');
    const fileData = await fs.readFile(filePath);

    const loader = new GraphicsLoader();
    loader.loadFromArray(new Uint8Array(fileData));

    const itemCount = loader.getItemCount();
    console.log(`Total graphics: ${itemCount}\n`);

    // Get all graphics info
    const data = loader.getData();
    if (!data) {
        console.error('No graphics data loaded');
        return;
    }

    console.log('Index | Width  | Height | CompSize | DecompSize | Aspect | Notes');
    console.log('------|--------|--------|----------|------------|--------|-------');

    for (let i = 0; i < Math.min(itemCount, 200); i++) {
        const entry = data.entries[i];

        try {
            const image = loader.getImage(i);
            const aspect = (image.width / image.height).toFixed(2);

            // Try to categorize based on dimensions
            let notes = '';
            if (image.width === 224 && image.height === 136) {
                notes = 'Full viewport';
            } else if (image.width > 100 && image.height > 80) {
                notes = 'Large (title/credits?)';
            } else if (image.width === image.height) {
                notes = 'Square';
            } else if (image.width > image.height * 2) {
                notes = 'Wide';
            } else if (image.height > image.width * 2) {
                notes = 'Tall (wall?)';
            }

            console.log(
                `${i.toString().padStart(5)} | ` +
                `${image.width.toString().padStart(6)} | ` +
                `${image.height.toString().padStart(6)} | ` +
                `${entry.compressedSize.toString().padStart(8)} | ` +
                `${entry.decompressedSize.toString().padStart(10)} | ` +
                `${aspect.padStart(6)} | ${notes}`
            );
        } catch (error) {
            console.log(
                `${i.toString().padStart(5)} | ` +
                `ERROR  | ERROR  | ` +
                `${entry.compressedSize.toString().padStart(8)} | ` +
                `${entry.decompressedSize.toString().padStart(10)} | ` +
                `ERROR  | ${(error as Error).message}`
            );
        }
    }

    console.log('\n--- Summary by dimensions ---\n');

    // Group by dimensions
    const dimensionGroups = new Map<string, number[]>();

    for (let i = 0; i < Math.min(itemCount, 200); i++) {
        try {
            const image = loader.getImage(i);
            const key = `${image.width}x${image.height}`;
            if (!dimensionGroups.has(key)) {
                dimensionGroups.set(key, []);
            }
            dimensionGroups.get(key)!.push(i);
        } catch (error) {
            // Skip errors
        }
    }

    // Sort by count
    const sorted = Array.from(dimensionGroups.entries())
        .sort((a, b) => b[1].length - a[1].length);

    for (const [dimensions, indices] of sorted) {
        const [width, height] = dimensions.split('x').map(Number);
        const aspect = (width / height).toFixed(2);
        console.log(
            `${dimensions.padEnd(12)} (${aspect.padStart(4)} ratio) : ` +
            `${indices.length.toString().padStart(3)} graphics - indices ${indices[0]}-${indices[indices.length - 1]}`
        );

        // Show first few indices
        if (indices.length <= 10) {
            console.log(`    [${indices.join(', ')}]`);
        }
    }
}

inspectGraphics().catch(console.error);
