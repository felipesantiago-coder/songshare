const express = require('express');
const cors = require('cors');
const { ExpressPeerServer } = require('peer');

const app = express();
const server = require('http').createServer(app);

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));

const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/peerjs'
});

app.use('/peerjs', peerServer);

app.get('/', (req, res) => res.send('SongShare Signaling Online 🚀'));

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`🟢 Servidor rodando na porta ${PORT}`));
