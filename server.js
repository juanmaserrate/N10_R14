const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Data helpers ---
function readData() {
    if (!fs.existsSync(DATA_FILE)) {
        const initial = { currentTodos: [], notes: '', history: [] };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
        return initial;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- API Routes ---

// Get current state
app.get('/api/data', (req, res) => {
    res.json(readData());
});

// Add todo
app.post('/api/todos', (req, res) => {
    const data = readData();
    const todo = {
        id: Date.now().toString(),
        text: req.body.text,
        owner: req.body.owner,
        done: false,
        createdAt: new Date().toISOString()
    };
    data.currentTodos.push(todo);
    writeData(data);
    res.json(todo);
});

// Toggle todo
app.patch('/api/todos/:id', (req, res) => {
    const data = readData();
    const todo = data.currentTodos.find(t => t.id === req.params.id);
    if (!todo) return res.status(404).json({ error: 'Not found' });
    todo.done = !todo.done;
    writeData(data);
    res.json(todo);
});

// Delete todo
app.delete('/api/todos/:id', (req, res) => {
    const data = readData();
    data.currentTodos = data.currentTodos.filter(t => t.id !== req.params.id);
    writeData(data);
    res.json({ ok: true });
});

// Save notes
app.put('/api/notes', (req, res) => {
    const data = readData();
    data.notes = req.body.notes;
    writeData(data);
    res.json({ ok: true });
});

// End meeting -> save to history, carry over pending todos
app.post('/api/meeting/end', (req, res) => {
    const data = readData();
    const record = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        todos: data.currentTodos,
        notes: data.notes,
        rating: req.body.rating || 0
    };
    data.history.unshift(record);

    // Carry over incomplete todos, mark them as carried
    const pending = data.currentTodos
        .filter(t => !t.done)
        .map(t => ({ ...t, id: Date.now().toString() + Math.random().toString(36).slice(2, 6), carried: true }));
    data.currentTodos = pending;
    data.notes = '';

    writeData(data);
    res.json({ record, pendingCount: pending.length });
});

// Get history
app.get('/api/history', (req, res) => {
    const data = readData();
    res.json(data.history);
});

// Delete history entry
app.delete('/api/history/:id', (req, res) => {
    const data = readData();
    data.history = data.history.filter(h => h.id !== req.params.id);
    writeData(data);
    res.json({ ok: true });
});

app.listen(PORT, () => {
    console.log(`Reunion N10 running on http://localhost:${PORT}`);
});
