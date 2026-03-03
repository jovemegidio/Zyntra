const ALLOWED_MIMES = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/gif': ['.gif'],
    'application/pdf': ['.pdf'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    'application/vnd.ms-excel': ['.xls'],
    'text/csv': ['.csv'],
    'text/plain': ['.txt'],
    'application/xml': ['.xml']
};
const MAX_FILE_SIZE = 50 * 1024 * 1024;
function validateUpload(req, res, next) {
    if (!req.file && !req.files) return next();
    const files = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : [req.file];
    for (const file of files) {
        if (!file) continue;
        if (!ALLOWED_MIMES[file.mimetype]) {
            return res.status(400).json({ message: 'Tipo de arquivo nao permitido: ' + file.mimetype });
        }
        if (file.size > MAX_FILE_SIZE) {
            return res.status(400).json({ message: 'Arquivo muito grande (max 50MB)' });
        }
    }
    next();
}
module.exports = { validateUpload, ALLOWED_MIMES, MAX_FILE_SIZE };
