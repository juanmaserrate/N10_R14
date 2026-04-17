const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection - Railway provides DATABASE_URL automatically
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Initialize database tables ---
async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS todos (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL,
            owner TEXT NOT NULL,
            done BOOLEAN DEFAULT FALSE,
            carried BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY DEFAULT 1,
            content TEXT DEFAULT ''
        )
    `);
    await pool.query(`INSERT INTO notes (id, content) VALUES (1, '') ON CONFLICT (id) DO NOTHING`);
    // Rocks table
    await pool.query(`
        CREATE TABLE IF NOT EXISTS rocks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            owner TEXT NOT NULL,
            on_track BOOLEAN DEFAULT TRUE,
            due_date DATE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    // Headlines table
    await pool.query(`
        CREATE TABLE IF NOT EXISTS headlines (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL,
            owner TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS history (
            id TEXT PRIMARY KEY,
            date TIMESTAMPTZ DEFAULT NOW(),
            todos JSONB DEFAULT '[]',
            notes TEXT DEFAULT '',
            rating INTEGER DEFAULT 0,
            ratings JSONB DEFAULT '{}',
            headlines_data JSONB DEFAULT '[]',
            rocks_data JSONB DEFAULT '[]'
        )
    `);
    // Add columns to existing history tables
    await pool.query(`ALTER TABLE history ADD COLUMN IF NOT EXISTS ratings JSONB DEFAULT '{}'`);
    await pool.query(`ALTER TABLE history ADD COLUMN IF NOT EXISTS headlines_data JSONB DEFAULT '[]'`);
    await pool.query(`ALTER TABLE history ADD COLUMN IF NOT EXISTS rocks_data JSONB DEFAULT '[]'`);
    await pool.query(`ALTER TABLE history ADD COLUMN IF NOT EXISTS checkins_data JSONB DEFAULT '[]'`);
    await pool.query(`ALTER TABLE history ADD COLUMN IF NOT EXISTS ids_data JSONB DEFAULT '[]'`);
    console.log('Database tables ready');
}

// --- API Routes ---

// Get current state
app.get('/api/data', async (req, res) => {
    try {
        const todos = await pool.query('SELECT * FROM todos ORDER BY created_at ASC');
        const notes = await pool.query('SELECT content FROM notes WHERE id = 1');
        const rocks = await pool.query('SELECT * FROM rocks ORDER BY created_at ASC');
        const headlines = await pool.query('SELECT * FROM headlines ORDER BY created_at ASC');
        res.json({
            currentTodos: todos.rows.map(r => ({
                id: r.id, text: r.text, owner: r.owner,
                done: r.done, carried: r.carried
            })),
            notes: notes.rows[0]?.content || '',
            rocks: rocks.rows.map(r => ({
                id: r.id, title: r.title, owner: r.owner,
                on_track: r.on_track, due_date: r.due_date
            })),
            headlines: headlines.rows.map(r => ({
                id: r.id, text: r.text, owner: r.owner
            })),
            history: []
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

// Add todo
app.post('/api/todos', async (req, res) => {
    try {
        const id = Date.now().toString();
        const { text, owner } = req.body;
        await pool.query(
            'INSERT INTO todos (id, text, owner, done, carried) VALUES ($1, $2, $3, FALSE, FALSE)',
            [id, text, owner]
        );
        res.json({ id, text, owner, done: false, carried: false });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

// Toggle todo
app.patch('/api/todos/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE todos SET done = NOT done WHERE id = $1 RETURNING *',
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const r = result.rows[0];
        res.json({ id: r.id, text: r.text, owner: r.owner, done: r.done, carried: r.carried });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

// Delete todo
app.delete('/api/todos/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM todos WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

// --- ROCKS CRUD ---
app.post('/api/rocks', async (req, res) => {
    try {
        const id = Date.now().toString();
        const { title, owner, due_date } = req.body;
        await pool.query(
            'INSERT INTO rocks (id, title, owner, on_track, due_date) VALUES ($1, $2, $3, TRUE, $4)',
            [id, title, owner, due_date || null]
        );
        res.json({ id, title, owner, on_track: true, due_date: due_date || null });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

app.patch('/api/rocks/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE rocks SET on_track = NOT on_track WHERE id = $1 RETURNING *',
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const r = result.rows[0];
        res.json({ id: r.id, title: r.title, owner: r.owner, on_track: r.on_track, due_date: r.due_date });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

app.delete('/api/rocks/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM rocks WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

// --- HEADLINES CRUD ---
app.post('/api/headlines', async (req, res) => {
    try {
        const id = Date.now().toString();
        const { text, owner } = req.body;
        await pool.query(
            'INSERT INTO headlines (id, text, owner) VALUES ($1, $2, $3)',
            [id, text, owner]
        );
        res.json({ id, text, owner });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

app.delete('/api/headlines/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM headlines WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

// Save notes
app.put('/api/notes', async (req, res) => {
    try {
        await pool.query('UPDATE notes SET content = $1 WHERE id = 1', [req.body.notes]);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

// End meeting -> save to history, carry over pending todos
app.post('/api/meeting/end', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get all current data
        const todosResult = await client.query('SELECT * FROM todos ORDER BY created_at ASC');
        const notesResult = await client.query('SELECT content FROM notes WHERE id = 1');
        const rocksResult = await client.query('SELECT * FROM rocks ORDER BY created_at ASC');
        const headlinesResult = await client.query('SELECT * FROM headlines ORDER BY created_at ASC');

        const currentTodos = todosResult.rows.map(r => ({
            id: r.id, text: r.text, owner: r.owner, done: r.done, carried: r.carried
        }));
        const currentNotes = notesResult.rows[0]?.content || '';
        const currentRocks = rocksResult.rows.map(r => ({
            id: r.id, title: r.title, owner: r.owner, on_track: r.on_track, due_date: r.due_date
        }));
        const currentHeadlines = headlinesResult.rows.map(r => ({
            id: r.id, text: r.text, owner: r.owner
        }));

        // Calculate average rating from per-user ratings
        const ratings = req.body.ratings || {};
        const ratingValues = Object.values(ratings).filter(v => v > 0);
        const avgRating = ratingValues.length > 0
            ? Math.round(ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length)
            : (req.body.rating || 0);

        // Check-ins and IDS data from client
        const checkinsData = req.body.checkins || [];
        const idsData = req.body.ids || [];

        // Save to history with all fields (date auto-set to NOW by server)
        const historyId = Date.now().toString();
        await client.query(
            'INSERT INTO history (id, date, todos, notes, rating, ratings, headlines_data, rocks_data, checkins_data, ids_data) VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9)',
            [historyId, JSON.stringify(currentTodos), currentNotes, avgRating, JSON.stringify(ratings), JSON.stringify(currentHeadlines), JSON.stringify(currentRocks), JSON.stringify(checkinsData), JSON.stringify(idsData)]
        );

        // Delete all current todos
        await client.query('DELETE FROM todos');

        // Re-insert only pending (not done) as carried
        const pending = currentTodos.filter(t => !t.done);
        for (const t of pending) {
            const newId = Date.now().toString() + Math.random().toString(36).slice(2, 6);
            await client.query(
                'INSERT INTO todos (id, text, owner, done, carried) VALUES ($1, $2, $3, FALSE, TRUE)',
                [newId, t.text, t.owner]
            );
        }

        // Clear notes and headlines (rocks persist across meetings)
        await client.query('UPDATE notes SET content = $2 WHERE id = $1', [1, '']);
        await client.query('DELETE FROM headlines');

        await client.query('COMMIT');
        res.json({ record: { id: historyId }, pendingCount: pending.length });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    } finally {
        client.release();
    }
});

// Get history
app.get('/api/history', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM history ORDER BY date DESC LIMIT 50');
        res.json(result.rows.map(r => ({
            id: r.id, date: r.date, todos: r.todos, notes: r.notes,
            rating: r.rating, ratings: r.ratings || {},
            headlines_data: r.headlines_data || [],
            rocks_data: r.rocks_data || [],
            checkins_data: r.checkins_data || [],
            ids_data: r.ids_data || []
        })));
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

// Delete history entry
app.delete('/api/history/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM history WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

// Start server after DB is ready
initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Reunion N10 running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Failed to initialize DB:', err);
    process.exit(1);
});
