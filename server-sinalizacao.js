const express = require('express');
const cors = require('cors');
const { ExpressPeerServer } = require('peer');

const app = express();
const server = require('http').createServer(app);

// CONFIGURAÇÃO CORS CRÍTICA PARA PRODUÇÃO
app.use(cors({
  origin: '*', // Permite qualquer origem (Vercel, localhost, etc)
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/peerjs',
  // Configuração adicional de CORS dentro do próprio PeerJS
  allow_origin: '*' 
});

app.use('/peerjs', peerServer);

app.get('/', (req, res) => {
  res.send('Servidor de Sinalização SongShare está ONLINE! 🚀');
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`🟢 Servidor rodando na porta ${PORT}`);
});
