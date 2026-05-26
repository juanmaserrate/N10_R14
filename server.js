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
    await pool.query(`ALTER TABLE history ADD COLUMN IF NOT EXISTS win TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE history ADD COLUMN IF NOT EXISTS improvement TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE history ADD COLUMN IF NOT EXISTS concerns JSONB DEFAULT '{}'`);
    // IDS items - persisten entre reuniones para carry-over
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ids_items (
            id TEXT PRIMARY KEY,
            topic TEXT DEFAULT '',
            identify TEXT DEFAULT '',
            discuss TEXT DEFAULT '',
            solve TEXT DEFAULT '',
            priority TEXT DEFAULT 'media',
            owner TEXT DEFAULT '',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    // Scorecard tables — weekly KPIs by department, columns = Mondays
    await pool.query(`
        CREATE TABLE IF NOT EXISTS scorecard_weeks (
            week_of DATE PRIMARY KEY,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS scorecard (
            week_of DATE NOT NULL,
            metric_key TEXT NOT NULL,
            value NUMERIC,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (week_of, metric_key)
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS scorecard_targets (
            metric_key TEXT PRIMARY KEY,
            target_value NUMERIC,
            comparator TEXT DEFAULT '>='
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
        const rocks = await pool.query('SELECT * FROM rocks ORDER BY created_at ASC');
        const headlines = await pool.query('SELECT * FROM headlines ORDER BY created_at ASC');
        const ids = await pool.query('SELECT * FROM ids_items ORDER BY created_at ASC');
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
            ids: ids.rows.map(r => ({
                id: r.id, topic: r.topic, identify: r.identify, discuss: r.discuss, solve: r.solve,
                priority: r.priority || 'media', owner: r.owner || '', created_at: r.created_at
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

// Toggle todo (or SET if body.done is a boolean)
app.patch('/api/todos/:id', async (req, res) => {
    try {
        let result;
        if (req.body && typeof req.body.done === 'boolean') {
            result = await pool.query(
                'UPDATE todos SET done = $1 WHERE id = $2 RETURNING *',
                [req.body.done, req.params.id]
            );
        } else {
            // Backwards-compat: toggle if no explicit value given
            result = await pool.query(
                'UPDATE todos SET done = NOT done WHERE id = $1 RETURNING *',
                [req.params.id]
            );
        }
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

// --- IDS ITEMS CRUD ---
app.get('/api/ids', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ids_items ORDER BY created_at ASC');
        res.json(result.rows.map(r => ({
            id: r.id, topic: r.topic, identify: r.identify, discuss: r.discuss, solve: r.solve,
            priority: r.priority || 'media', owner: r.owner || '', created_at: r.created_at
        })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'DB error' }); }
});
app.post('/api/ids', async (req, res) => {
    try {
        const id = Date.now().toString() + Math.random().toString(36).slice(2,5);
        const { topic='', identify='', discuss='', solve='', priority='media', owner='' } = req.body || {};
        await pool.query(
            'INSERT INTO ids_items (id, topic, identify, discuss, solve, priority, owner) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [id, topic, identify, discuss, solve, priority, owner]
        );
        res.json({ id, topic, identify, discuss, solve, priority, owner, created_at: new Date().toISOString() });
    } catch (e) { console.error(e); res.status(500).json({ error: 'DB error' }); }
});
app.put('/api/ids/:id', async (req, res) => {
    try {
        const allowed = ['topic','identify','discuss','solve','priority','owner'];
        const fields = [], values = [];
        for (const k of allowed) {
            if (k in (req.body || {})) { fields.push(`${k} = $${fields.length+1}`); values.push(req.body[k]); }
        }
        if (!fields.length) return res.json({ ok: true });
        values.push(req.params.id);
        await pool.query(`UPDATE ids_items SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
        res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'DB error' }); }
});
app.delete('/api/ids/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM ids_items WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'DB error' }); }
});
// Convert IDS solve into a To-Do + delete the IDS item
app.post('/api/ids/:id/convert-to-todo', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const r = await client.query('SELECT * FROM ids_items WHERE id = $1', [req.params.id]);
        if (r.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
        const iss = r.rows[0];
        const todoText = (iss.solve && iss.solve.trim()) || (iss.topic && iss.topic.trim()) || 'IDS sin texto';
        const todoOwner = iss.owner && iss.owner.trim() ? iss.owner : (req.body?.fallbackOwner || 'Equipo');
        const todoId = Date.now().toString() + Math.random().toString(36).slice(2,5);
        await client.query('INSERT INTO todos (id, text, owner, done, carried) VALUES ($1,$2,$3,FALSE,FALSE)', [todoId, todoText, todoOwner]);
        await client.query('DELETE FROM ids_items WHERE id = $1', [req.params.id]);
        await client.query('COMMIT');
        res.json({ ok: true, todo: { id: todoId, text: todoText, owner: todoOwner, done: false, carried: false } });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e); res.status(500).json({ error: 'DB error' });
    } finally { client.release(); }
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

        // Check-ins from client (transient)
        const checkinsData = req.body.checkins || [];
        // IDS: snapshot from DB (persistent across meetings; carries over automatically)
        const idsResult = await client.query('SELECT * FROM ids_items ORDER BY created_at ASC');
        const idsData = idsResult.rows.map(r => ({
            id: r.id, topic: r.topic, identify: r.identify, discuss: r.discuss, solve: r.solve,
            priority: r.priority || 'media', owner: r.owner || ''
        }));
        // Win / Improvement / Concerns for retro
        const win = (req.body.win || '').trim();
        const improvement = (req.body.improvement || '').trim();
        const concerns = req.body.concerns || {};

        // Save to history with all fields (date auto-set to NOW by server)
        const historyId = Date.now().toString();
        await client.query(
            'INSERT INTO history (id, date, todos, notes, rating, ratings, headlines_data, rocks_data, checkins_data, ids_data, win, improvement, concerns) VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
            [historyId, JSON.stringify(currentTodos), currentNotes, avgRating, JSON.stringify(ratings), JSON.stringify(currentHeadlines), JSON.stringify(currentRocks), JSON.stringify(checkinsData), JSON.stringify(idsData), win, improvement, JSON.stringify(concerns)]
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
            ids_data: r.ids_data || [],
            win: r.win || '',
            improvement: r.improvement || '',
            concerns: r.concerns || {}
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

// --- SCORECARD ---
// Get all scorecard data: weeks list + cell values + targets
app.get('/api/scorecard', async (req, res) => {
    try {
        const weeksRes = await pool.query('SELECT week_of FROM scorecard_weeks ORDER BY week_of DESC');
        const cellsRes = await pool.query('SELECT week_of, metric_key, value FROM scorecard');
        const targetsRes = await pool.query('SELECT metric_key, target_value, comparator FROM scorecard_targets');
        const weeks = weeksRes.rows.map(r => {
            const wk = r.week_of instanceof Date ? r.week_of.toISOString().slice(0,10) : String(r.week_of).slice(0,10);
            return { week_of: wk, values: {} };
        });
        const byWeek = Object.fromEntries(weeks.map(w => [w.week_of, w]));
        for (const c of cellsRes.rows) {
            const wk = c.week_of instanceof Date ? c.week_of.toISOString().slice(0,10) : String(c.week_of).slice(0,10);
            if (byWeek[wk]) byWeek[wk].values[c.metric_key] = c.value === null ? '' : Number(c.value);
        }
        const targets = {};
        for (const t of targetsRes.rows) {
            targets[t.metric_key] = {
                value: t.target_value === null ? '' : Number(t.target_value),
                comparator: t.comparator || '>='
            };
        }
        res.json({ weeks, targets });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

// Upsert target value + comparator for a metric
app.put('/api/scorecard/targets/:key', async (req, res) => {
    try {
        const { target_value, comparator } = req.body;
        const numVal = (target_value === '' || target_value === null || target_value === undefined) ? null : Number(target_value);
        const validComps = ['>=','<=','>','<','='];
        const comp = validComps.includes(comparator) ? comparator : '>=';
        await pool.query(
            `INSERT INTO scorecard_targets (metric_key, target_value, comparator) VALUES ($1, $2, $3)
             ON CONFLICT (metric_key) DO UPDATE SET target_value = EXCLUDED.target_value, comparator = EXCLUDED.comparator`,
            [req.params.key, numVal, comp]
        );
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

// Register a new week column
app.post('/api/scorecard/week', async (req, res) => {
    try {
        const { week_of } = req.body;
        if (!week_of) return res.status(400).json({ error: 'week_of required' });
        await pool.query('INSERT INTO scorecard_weeks (week_of) VALUES ($1) ON CONFLICT DO NOTHING', [week_of]);
        res.json({ ok: true, week_of });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

// Upsert a single cell (auto-registers the week)
app.put('/api/scorecard/cell', async (req, res) => {
    try {
        const { week_of, metric_key, value } = req.body;
        if (!week_of || !metric_key) return res.status(400).json({ error: 'week_of and metric_key required' });
        const numVal = (value === '' || value === null || value === undefined) ? null : Number(value);
        await pool.query('INSERT INTO scorecard_weeks (week_of) VALUES ($1) ON CONFLICT DO NOTHING', [week_of]);
        await pool.query(
            `INSERT INTO scorecard (week_of, metric_key, value, updated_at) VALUES ($1, $2, $3, NOW())
             ON CONFLICT (week_of, metric_key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [week_of, metric_key, numVal]
        );
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    }
});

// Delete a whole week (and its cells)
app.delete('/api/scorecard/week/:week_of', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM scorecard WHERE week_of = $1', [req.params.week_of]);
        await client.query('DELETE FROM scorecard_weeks WHERE week_of = $1', [req.params.week_of]);
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
        res.status(500).json({ error: 'DB error' });
    } finally {
        client.release();
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
