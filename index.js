const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

bot.on('message', (msg) => {
  const chatId = msg.chat.id;

  if (msg.text.toLowerCase() === 'привет') {
    bot.sendMessage(chatId, 'Привет, я живой!');
  }
});
