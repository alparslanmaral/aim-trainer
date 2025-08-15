// Basit Socket.IO tabanlı multiplayer sunucu
// Statik dosyaları servis eder, oyuncu durumlarını yayınlar.

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Aynı origin üzerinden servis ettiğimiz için CORS gerekmez; farklı origin kullanacaksanız açın.
  cors: { origin: '*' }
});

// Statik client dosyaları (index.html, main.js, styles.css)
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;

// Tüm oyuncular tek bir odaya (default) giriyor
const players = new Map(); // id -> { name, state, lastUpdate }

io.on('connection', (socket) => {
  console.log('Yeni bağlantı:', socket.id);

  // Yeni gelen oyuncuya mevcut oyuncu listesini gönder
  const initial = [];
  for (const [id, p] of players.entries()) {
    initial.push({ id, name: p.name || `P-${id.slice(0, 4)}`, state: p.state || null });
  }
  socket.emit('players:init', initial);

  // Oyuncu katıldı bilgisi
  socket.on('join', ({ name }) => {
    players.set(socket.id, { name: name || `P-${socket.id.slice(0, 4)}`, state: null, lastUpdate: Date.now() });
    socket.broadcast.emit('player:joined', { id: socket.id, name: name || `P-${socket.id.slice(0, 4)}` });
  });

  // Oyuncu durum güncellemesi (x,y,z,yaw,pitch,ts)
  socket.on('state', (state) => {
    const p = players.get(socket.id);
    if (p) {
      p.state = state;
      p.lastUpdate = Date.now();
      // Gönderen hariç herkese yay
      socket.broadcast.emit('player:state', { id: socket.id, state });
    }
  });

  socket.on('disconnect', () => {
    const existed = players.delete(socket.id);
    if (existed) {
      io.emit('player:left', { id: socket.id });
    }
    console.log('Ayrıldı:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});