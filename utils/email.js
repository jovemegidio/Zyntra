// =================================================================
// CONFIGURAÇÃO DE EMAIL - ALUFORCE v2.0
// Módulo centralizado para envio de emails via Nodemailer
// =================================================================
'use strict';

const nodemailer = require('nodemailer');
const logger = require('../src/logger');

let emailTransporter = null;

// Função para inicializar o transporter de email
function initEmailTransporter() {
    try {
        emailTransporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true', // true para 465, false para outras portas
            auth: {
                user: process.env.SMTP_USER || 'sistema@aluforce.ind.br',
                pass: process.env.SMTP_PASS || ''
            },
            tls: {
                rejectUnauthorized: false // Para ambientes de desenvolvimento
            }
        });

        // Verificar conexão SMTP
        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            emailTransporter.verify((error, success) => {
                if (error) {
                    logger.warn('[EMAIL] ❌ SMTP não configurado ou erro na conexão:', error.message);
                    logger.warn('[EMAIL] ❌ Emails não serão enviados. Configure variáveis de ambiente SMTP_*');
                } else {
                    logger.info('[EMAIL] ✅ Servidor SMTP configurado e pronto para enviar emails');
                }
            });
        } else {
            logger.warn('[EMAIL] ❌ Credenciais SMTP não configuradas. Emails não serão enviados.');
            logger.warn('[EMAIL] ❌ Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS no .env');
        }
    } catch (error) {
        logger.error('[EMAIL] ❌ Erro ao inicializar Nodemailer:', error);
    }
}

// Função auxiliar para enviar emails
async function sendEmail(to, subject, html, text) {
    if (!emailTransporter || !process.env.SMTP_USER) {
        logger.warn(`[EMAIL] Email não enviado (SMTP não configurado): ${subject}`);
        return { success: false, error: 'SMTP não configurado' };
    }

    try {
        const info = await emailTransporter.sendMail({
            from: `"ALUFORCE Sistema" <${process.env.SMTP_USER}>`,
            to: to,
            subject: subject,
            text: text || html.replace(/<[^>]*>/g, ''), // Fallback text
            html: html
        });

        logger.info(`[EMAIL] ✅ Email enviado: ${subject} → ${to} (ID: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error(`[EMAIL] ❌ Erro ao enviar email: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// Getter para o transporter
function getTransporter() {
    return emailTransporter;
}

// Verificar se email está configurado
function isConfigured() {
    return emailTransporter !== null && !!process.env.SMTP_USER;
}

module.exports = {
    initEmailTransporter,
    sendEmail,
    getTransporter,
    isConfigured
};
