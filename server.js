
const express = require('express');
require('dotenv').config();
const path = require('path');
const esbuild = require('esbuild');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;
const API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;

/**
 * Middleware xử lý transpile file .tsx và .ts sang JavaScript (ESM).
 * Giúp trình duyệt có thể thực thi code React trực tiếp từ file nguồn.
 */
app.get(['/*.tsx', '/*.ts'], async (req, res) => {
    const filePath = path.join(__dirname, req.path);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

    try {
        const result = await esbuild.build({
            entryPoints: [filePath],
            bundle: true,
            write: false,
            format: 'esm',
            target: 'es2022',
            loader: {
                '.tsx': 'tsx',
                '.ts': 'ts',
                '.css': 'css',
                '.json': 'json',
                '.png': 'file',
                '.jpg': 'file',
                '.svg': 'file',
                '.woff': 'file',
                '.woff2': 'file'
            },
            // Alias hỗ trợ import @/*
            alias: {
                '@': __dirname
            },
            // Giữ lại các thư viện để Browser load qua các script tags/importmaps
            external: [
                'react',
                'react-dom',
                'react/jsx-runtime',
                'react/jsx-dev-runtime',
                'recharts',
                '@google/genai',
                'react-grid-layout',
                'react-resizable',
                'react-router-dom',
                '@dnd-kit/core',
                '@dnd-kit/sortable',
                '@dnd-kit/utilities',
                'lucide-react'
            ],
            sourcemap: 'inline',
            define: {
                'process.env.API_KEY': JSON.stringify(API_KEY || ''),
                'process.env.GEMINI_API_KEY': JSON.stringify(API_KEY || ''),
                'process.env.GOOGLE_CLIENT_ID': JSON.stringify(process.env.GOOGLE_CLIENT_ID || ''),
                'process': JSON.stringify({
                    env: {
                        API_KEY: API_KEY || '',
                        GEMINI_API_KEY: API_KEY || '',
                        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || ''
                    }
                })
            }
        });
        res.type('application/javascript').send(result.outputFiles[0].text);
    } catch (err) {
        console.error('Build error:', err);
        res.status(500).send(err.message);
    }
});

// Phục vụ file tĩnh (CSS, JSON, hình ảnh)
app.use(express.static(__dirname));

// Hỗ trợ Routing cho Single Page Application (SPA)
app.get('*', (req, res) => {
    if (path.extname(req.path)) {
        res.status(404).send('Not found');
    } else {
        res.sendFile(path.join(__dirname, 'index.html'));
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is listening on port ${PORT}`);
    if (process.env.GOOGLE_CLIENT_ID) {
        console.log(`✅ GOOGLE_CLIENT_ID is loaded: ${process.env.GOOGLE_CLIENT_ID.substring(0, 10)}...`);
    } else {
        console.error(`❌ GOOGLE_CLIENT_ID is missing in .env file!`);
    }

    if (API_KEY) {
        console.log(`✅ GEMINI_API_KEY is loaded: ${API_KEY.substring(0, 10)}...`);
    } else {
        console.error(`❌ GEMINI_API_KEY / API_KEY is missing in .env file!`);
    }
});
