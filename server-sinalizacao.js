const express = require('express');
const cors = require('cors');
const { ExpressPeerServer } = require('peer');

const app = express();
const server = require('http').createServer(app);

// Habilita CORS para qualquer origem (necessário para P2P)
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/',
  allow_origin: '*', // CRUCIAL: Permite conexões de qualquer domínio (Vercel)
  concurrent_limit: 10000, // Limite de conexões simultâneas
  generateClientId: () => require('uuid').v4(), // Gera IDs únicos
  // Configurações de heartbeat para manter conexões vivas no Render
  pingInterval: 5000, // Envia ping a cada 5 segundos
  pingTimeout: 10000 // Timeout de 10 segundos para resposta
});

app.use('/peerjs', peerServer);

// Endpoint de health check para o servidor PeerJS
app.get('/peerjs/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Lista de peers conectados (para debugging)
app.get('/peerjs/id', (req, res) => {
  res.json({ id: 'peerjs-server', version: '1.5.5' });
});

app.get('/', (req, res) => {
  res.send('Servidor de Sinalização SongShare está ONLINE! 🚀');
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🟢 Servidor rodando na porta ${PORT}`);
});
