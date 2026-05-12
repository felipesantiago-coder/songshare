const express = require('express');
const cors = require('cors');
const { ExpressPeerServer } = require('peer');

const app = express();
const server = require('http').createServer(app);

app.use(cors({ origin: '*' }));

const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/peerjs'
});

app.use('/peerjs', peerServer);

app.get('/', (req, res) => {
  res.send('Servidor de Sinalização SongShare ONLINE! 🟢');
});

const PORT = process.env.PORT || 9000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
