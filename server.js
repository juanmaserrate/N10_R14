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
    await pool.query(`
        CREATE TABLE IF NOT EXISTS history (
            id TEXT PRIMARY KEY,
            date TIMESTAMPTZ DEFAULT NOW(),
            todos JSONB DEFAULT '[]',
            notes TEXT DEFAULT '',
            rating INTEGER DEFAULT 0
        )
    `);
    console.log('Database tables ready');
}

// --- API Routes ---

// Get current state
app.get('/api/data', async (req, res) => {
    try {
        const todos = await pool.query('SELECT * FROM todos ORDER BY created_at ASC');
        const notes = await pool.query('SELECT content FROM notes WHERE id = 1');
        res.json({
            currentTodos: todos.rows.map(r => ({
                id: r.id, text: r.text, owner: r.owner,
                done: r.done, carried: r.carried
            })),
            notes: notes.rows[0]?.content || '',
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

        // Get current todos and notes
        const todosResult = await client.query('SELECT * FROM todos ORDER BY created_at ASC');
        const notesResult = await client.query('SELECT content FROM notes WHERE id = 1');

        const currentTodos = todosResult.rows.map(r => ({
            id: r.id, text: r.text, owner: r.owner, done: r.done, carried: r.carried
        }));
        const currentNotes = notesResult.rows[0]?.content || '';

        // Save to history
        const historyId = Date.now().toString();
        await client.query(
            'INSERT INTO history (id, date, todos, notes, rating) VALUES ($1, NOW(), $2, $3, $4)',
            [historyId, JSON.stringify(currentTodos), currentNotes, req.body.rating || 0]
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

        // Clear notes
        await client.query('UPDATE notes SET content = $2 WHERE id = $1', [1, '']);

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
            id: r.id, date: r.date, todos: r.todos, notes: r.notes, rating: r.rating
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
