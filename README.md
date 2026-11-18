# 🁫 Dominó Pro

Jogo de dominó **online e profissional**: login, multiplayer em tempo real,
placar por rodadas, ranking e IA para quando não houver oponente disponível.
Funciona em celular (PWA instalável), tablet e desktop — sem precisar
ajustar a tela.

## Como rodar na máquina

```bash
npm install
npm run dev        # servidor (3001) + cliente (5173) juntos
```

- **http://localhost:5173** — cliente com recarga automática
- **http://localhost:3001** — servidor (também serve a versão de produção)

### Testes

```bash
node scripts/simulate.mjs 2000   # valida as regras em 2000 partidas IA × IA
node scripts/e2e.mjs             # testa API + socket + partida real + fila
npm run build                    # build de produção em client/dist
```

### Ícones do PWA

```bash
node scripts/make-icon.mjs       # gera icon-192/512 e apple-touch-icon
```

## Publicar no Render (grátis)

1. Suba este repositório para o GitHub.
2. Em [render.com](https://render.com) → **New** → **Web Service** → conecte o repositório.
3. O Render lê o `render.yaml` e configura tudo sozinho. Se pedir manualmente:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Env vars:** `NODE_ENV=production` e `JWT_SECRET` (gerado pelo Render)
4. Aguarde o deploy e use a URL `https://SEU-APP.onrender.com`.

> **Importante:** no plano gratuito o serviço dorme após ~15 min sem uso —
> a primeira pessoa a entrar acorda o servidor (leva ~30 s). Em produção de
> verdade, use um plano pago ou um servidor próprio.

## Funcionalidades

- **Login** com senha criptografada (bcrypt) e sessão por JWT (30 dias)
- **Fila online**: casa dois jogadores na hora; se ninguém responder em 8 s,
  a IA assume o lugar do adversário
- **Partida 1v1** até 61 pontos: compra, passe, bloqueio, W.O. e fechamento
- **IA** com heurística (continuidade, descarte de peças pesadas, bloqueio)
- **Ranking** e estatísticas por usuário
- **Reconexão**: caiu a internet? Ao voltar, você já está de volta na mesa
- **PWA**: instalável na tela inicial do celular, com ícone próprio
- **Som** sintetizado (WebAudio, sem arquivos) com botão de silenciar
- **Responsivo**: testado em 320×568, 390×844, 768 (tablet) e paisagem 740×390

## Estrutura

```
server/src/
  index.js     Express + Socket.IO + matchmaking + salas
  game.js      regras do dominó (engine validada por simulação)
  ai.js        bot adversário
  store.js     persistência de usuários (JSON)
client/src/
  App.jsx              autenticação, socket e navegação de fases
  components/          AuthScreen, Lobby, GameScreen, Tile
  gameBus.js           ponte socket ↔ tela de jogo
  sound.js             efeitos sonoros WebAudio
scripts/
  simulate.mjs         simulação em massa das regras
  e2e.mjs              teste ponta a ponta
  make-icon.mjs        geração dos ícones PNG
```
