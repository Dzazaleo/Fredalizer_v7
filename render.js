import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';

console.log("------------------------------------------------");
console.log("   🎬  FREDALIZER BATCH RENDER ENGINE  🎬    ");
console.log("------------------------------------------------");

// --- CONFIGURATION ---
const VIDEO_SOURCE_DIR = path.join('game_elements', 'footage');
const VIDEO_OUTPUT_DIR = path.join('game_elements', 'processed');

// Ensure output directory exists
if (!fs.existsSync(VIDEO_OUTPUT_DIR)) {
    console.log(`📂 Creating output folder: ${VIDEO_OUTPUT_DIR}`);
    fs.mkdirSync(VIDEO_OUTPUT_DIR, { recursive: true });
}

// --- HELPER: TIME PARSING ---
function parseTime(timeStr) {
    // Format: HH:MM:SS.ms
    const parts = timeStr.split(':');
    const hours = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    const seconds = parseFloat(parts[2]);
    return (hours * 3600) + (minutes * 60) + seconds;
}

// --- HELPER: PROGRESS BAR ---
function drawProgressBar(percent) {
    const width = 30;
    const completed = Math.floor(width * (percent / 100));
    const remaining = width - completed;
    
    // Create bar string
    const bar = '█'.repeat(completed) + '░'.repeat(remaining);
    
    // Clear line and write
    process.stdout.write(`\r   ⏳ Progress: [${bar}] ${percent.toFixed(1)}%`);
}

// --- 1. MULTI-MANIFEST LOADER ---
function loadAllManifests() {
    const files = fs.readdirSync('.');
    const manifestFiles = files.filter(f => f.startsWith('batch-cut-list') && f.endsWith('.json'));

    let combinedQueue = [];

    if (manifestFiles.length > 0) {
        console.log(`📚 Found ${manifestFiles.length} manifest file(s):`);
        manifestFiles.forEach(file => {
            console.log(`   - Loaded: ${file}`);
            try {
                const rawData = JSON.parse(fs.readFileSync(file, 'utf8'));
                const batchItems = Array.isArray(rawData) ? rawData : [rawData];
                combinedQueue = [...combinedQueue, ...batchItems];
            } catch (err) {
                console.error(`     ❌ Failed to parse ${file}: ${err.message}`);
            }
        });
    } else if (fs.existsSync('cut-list.json')) {
        console.log(`📄 Using Legacy Manifest: cut-list.json`);
        const rawData = JSON.parse(fs.readFileSync('cut-list.json', 'utf8'));
        combinedQueue = Array.isArray(rawData) ? rawData : [rawData];
    } else {
        return null;
    }

    return combinedQueue;
}

const queue = loadAllManifests();

if (!queue || queue.length === 0) {
    console.error(`❌ Error: No valid manifest files found (or they are empty).`);
    process.exit(1);
}

console.log(`\n📂 Total Jobs Queued: ${queue.length}`);
console.log(`📂 Source: ${VIDEO_SOURCE_DIR}`);
console.log(`📂 Output: ${VIDEO_OUTPUT_DIR}`);

// --- 2. PROCESSING LOOP ---
const processNext = (index) => {
    if (index >= queue.length) {
        console.log("\n\n✅ ALL MANIFESTS COMPLETED!");
        console.log("Press any key to exit...");
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', process.exit.bind(process, 0));
        return;
    }

    const data = queue[index];
    const inputVideo = data.file || data.fileName; 
    const ranges = data.keepRanges || data.ranges;

    if (!inputVideo) {
        console.error(`\n[${index + 1}/${queue.length}] ❌ Error: Job missing filename. Skipping.`);
        processNext(index + 1);
        return;
    }

    console.log(`\n[${index + 1}/${queue.length}] Processing: ${inputVideo}`);

    // --- Path Resolution ---
    const pathInSourceDir = path.join(VIDEO_SOURCE_DIR, inputVideo);
    const pathInRoot = inputVideo;
    let finalInputPath = '';

    if (fs.existsSync(pathInSourceDir)) {
        finalInputPath = pathInSourceDir;
    } else if (fs.existsSync(pathInRoot)) {
        finalInputPath = pathInRoot;
    } else {
        console.error(`   ❌ Skipped: File not found in source or root.`);
        processNext(index + 1);
        return;
    }

    if (!ranges || ranges.length === 0) {
        console.log("   ⚠️  No cuts needed. Skipped.");
        processNext(index + 1);
        return;
    }

    // --- FFmpeg Argument Build ---
    // Note: We reconstruct args array for spawn safety
    const args = [];
    args.push('-i', finalInputPath);

    let filterComplex = '';
    let concatInputs = '';

    ranges.forEach((r, i) => {
        const start = r.start.toFixed(3);
        const end = r.end.toFixed(3);
        filterComplex += `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}];`;
        filterComplex += `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}];`;
        concatInputs += `[v${i}][a${i}]`;
    });

    filterComplex += `${concatInputs}concat=n=${ranges.length}:v=1:a=1[outv][outa]`;

    args.push('-filter_complex', filterComplex);
    args.push('-map', '[outv]', '-map', '[outa]');
    args.push('-c:v', 'libx264', '-g', '1', '-crf', '12', '-tune', 'animation', '-pix_fmt', 'yuv420p');
    args.push('-c:a', 'aac', '-b:a', '320k');
    
    const namePart = path.parse(inputVideo).name;
    const extPart = path.parse(inputVideo).ext;
    const outputFileName = `${namePart}_clean${extPart}`;
    const finalOutputPath = path.join(VIDEO_OUTPUT_DIR, outputFileName);
    
    args.push(finalOutputPath, '-y');

    console.log(`   🚀 Rendering to: ${outputFileName}`);

    // --- EXECUTION VIA SPAWN ---
    const ffmpeg = spawn('ffmpeg', args);
    
    let duration = 0;

    ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();

        // 1. Extract Duration (Once)
        if (duration === 0) {
            const durMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2}.\d{2})/);
            if (durMatch) {
                duration = parseTime(`${durMatch[1]}:${durMatch[2]}:${durMatch[3]}`);
            }
        }

        // 2. Extract Progress Time
        const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2}.\d{2})/);
        if (timeMatch && duration > 0) {
            const currentTime = parseTime(`${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}`);
            const percent = Math.min(99.9, (currentTime / duration) * 100); // Cap at 99.9 until done
            drawProgressBar(percent);
        }
    });

    ffmpeg.on('close', (code) => {
        if (code === 0) {
            // FORCE VISUAL COMPLETION
            drawProgressBar(100.0); 
            process.stdout.write('\n'); // New line after bar
            console.log(`   ✅ Saved to: ${finalOutputPath}`);
        } else {
            process.stdout.write('\n');
            console.error(`   ❌ FFmpeg exited with code ${code}`);
        }
        processNext(index + 1);
    });

    ffmpeg.on('error', (err) => {
        console.error(`   ❌ Failed to start FFmpeg: ${err.message}`);
        processNext(index + 1);
    });
};

processNext(0);