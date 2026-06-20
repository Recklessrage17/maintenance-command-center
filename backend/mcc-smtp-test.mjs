import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config({ path: 'F:/maintenance-command-center/.env' });

const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];

for (const key of required) {
  console.log(`${key}: ${process.env[key] ? 'SET' : 'MISSING'}`);
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

try {
  console.log('Verifying SMTP...');
  await transporter.verify();
  console.log('SMTP verify passed.');

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: process.env.SMTP_USER,
    subject: 'MCC SMTP Test Email',
    text: 'This is a test email from Maintenance Command Center SMTP setup.',
  });

  console.log('Email sent.');
  console.log('Message ID:', info.messageId);
} catch (error) {
  console.error('SMTP TEST FAILED:');
  console.error(error?.message || error);
}
