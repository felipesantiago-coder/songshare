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
  path: '/peerjs',
  allow_origin: '*' // CRUCIAL: Permite conexões de qualquer domínio (Vercel)
});

app.use('/peerjs', peerServer);

app.get('/', (req, res) => {
  res.send('Servidor de Sinalização SongShare está ONLINE! 🚀');
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🟢 Servidor rodando na porta ${PORT}`);
});
