/**
 * Usuario Repository — encapsulates usuarios table queries.
 * @module repositories/usuario-repository
 */
const BaseRepository = require('./base-repository');

class UsuarioRepository extends BaseRepository {
    async findById(id) {
        return this.queryOne('SELECT id, nome, email, role, is_admin, foto, avatar, ativo FROM usuarios WHERE id = ?', [id]);
    }

    async findByEmail(email) {
        return this.queryOne('SELECT * FROM usuarios WHERE email = ?', [email]);
    }

    async findByLogin(login) {
        return this.queryOne('SELECT * FROM usuarios WHERE login = ? OR email = ?', [login, login]);
    }

    async listVendedores() {
        return this.query(
            "SELECT id, nome, email, comissao_percentual FROM usuarios WHERE role IN ('comercial','admin') AND ativo = 1 ORDER BY nome"
        );
    }

    async updateLastLogin(id) {
        return this.execute(
            'UPDATE usuarios SET ultimo_login = NOW(), login_count = login_count + 1 WHERE id = ?',
            [id]
        );
    }

    async getProfilePhoto(email) {
        const user = await this.queryOne(
            'SELECT foto, avatar, nome FROM usuarios WHERE email = ?',
            [email]
        );
        return user;
    }
}

module.exports = UsuarioRepository;
