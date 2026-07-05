'use strict';

function getPool() {
    return require('./database/pool');
}

module.exports = {
    getPool,
    get pool() {
        return getPool();
    }
};
