#!/bin/bash
echo "🚀 Iniciando instalação das dependências..."
npm install --production
echo "✅ Instalação concluída. Iniciando o servidor de sinalização..."
node server-sinalizacao.js
