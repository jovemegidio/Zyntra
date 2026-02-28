// Integração da API eSocial no servidor RH
const esocialApi = require('./api/esocial-api');

// ... (demais requires e middlewares)

// Registrar as rotas da API eSocial sob o namespace /api/esocial
app.use('/api/esocial', esocialApi);

// ... (demais rotas e inicialização do servidor)
