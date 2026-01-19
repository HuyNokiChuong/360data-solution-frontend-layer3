
const express = require('express');
const path = require('path');
const esbuild = require('esbuild');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

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
            loader: { '.tsx': 'tsx', '.ts': 'ts' },
            // Giữ lại các thư viện để Browser load qua importmap (esm.sh)
            external: ['react', 'react-dom', 'recharts', '@google/genai'],
            sourcemap: 'inline'
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
});
