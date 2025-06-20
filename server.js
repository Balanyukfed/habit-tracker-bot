const TelegramBot = require('node-telegram-bot-api');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const moment = require('moment');

// Настройки бота
const bot = new TelegramBot('8172145505:AAGBXRqK-RBjwzOyB-zaZatWYVtPr4-EHoM', { polling: true });
const doc = new GoogleSpreadsheet('1aaoPaD4BQQupcoViXez8pInE_LDNc6RSyz04ww2e1Xc');

// Аутентификация в Google Sheets
async function auth() {
  await doc.useServiceAccountAuth({
    client_email: 'habittrackerbot@habittrackerbot-463513.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDAIoiZIuFVWCeL\nsIURpSmPTWzItcQoAygsSXAGPlCNd+wbRM/dllpQbgTi/hHI12ndDxP0LMnlcIhM\nBfkGiVNmfMi7uWvPixIaTqG5a5rXziNNLwVstqiVboa+UphaPV21Z380hUckRpds\nHbfWqQQd3zuOF1b3NlOVAHsP3663SuEvx/2bxJ38g1a0eg/7woiBjGKuq3cScQ9y\nMF/MmLmOZ+Q6MPJfubL1xUHWVadEABJ6G/dFF/2QgMShFsX1yd0ktZZUccDpnd9T\n6yfkrwi+Spu0Zz3H378xulWRGeyTWfmefRSZ2tSyFqmlaH03CWjU8dpUCdfv5g+1\nc1+kuArRAgMBAAECggEAGdzcKc7n6ZLM+fD4LJSgqEVKCidrgN5R60o0XebH9Y8J\ntW75ExEQ1ahFmJ+OGcyjV6oWq8TWpX+VHTSlnYNhOle8NobCVCTaejeQ7fJl3LxH\nBLX6YzSgM0M2OIrKLsV5ZniIxzNUjPXCnr9OVoMYRoQc0mbiYjMKI7G1nwCjVlEu\nZ/aVQNTGcBYK/m9tSgrB0Oi/oaxEnoXESaitzc/hG5OEfpNk4BbH4DhoN/sEdhaT\nhRKD/JsM4nbn/rkrKZvDQog0tTcnfm1xj4HPi49oml4r6gMVSNuwkhvF8DmIDYDn\nbzmtoWfyHJT/3N25+ZmRDdT09HryR7ZuPh4+aebNBQKBgQDvF3cEzMRrb+C/U10Q\nGQrWLKkCkzmw7LLduLnloN2g/7t89MZ0MecSBvHLWiAVaVKMj5uerQ58BWgq7eJZ\nY1rMBVFZ2j5lvcnw1zx1i97imvUaYLQ/GBHOGC9xjcehZbtPu/C65KUUX916TE9N\nc101O/kqmGfq/lfd9BciJsLA5QKBgQDNuPWmRfTztIAzhmQGVgYh4GOHvDTVHsKH\n5ir2j9PDunAg5ZzFIaMu7HtVVYM4MkVp5MiWbiWYzUI3D19J7BzQ2eCIb/X5d+63\ndfm3jWeJjpaUbGqXNL353pKlCplRPCUnosZ644tMnvJmySzWUVfWm8daTz3Q+p4p\n2J6dCJG/fQKBgQDdu8pCZlEHPnOVnI9jPYZCSJrZa4aGYY4keIvWvRCtnl3Xrf5a\nhmlA27XknInCsbG/7/Mn/mC/fhg0L/fKZI0xRwFCLlfN7WxZ8pL8hKJJT+Jd+y9O\nkFj65I0jZ5SrRvinIqpH+YJrWdjB8gFd186qbxtOeJdvZUBB9Hx7zKyzTQKBgQCP\nN9nEdOVwGFQ8Cq5t/stsICQKZgs955k0NRfp6P1bQNs4+8ElOCK70ySVpt+gatcK\nPp0qpOoFs7gKTuhetULmXxhCw/cxQr5s+HPtxkKzcBICqGuYcr5jSwE6ZuOPu1h+\nfILDINBkei91QU62sZB+NpsVkx8M8rzTkxvxZPranQKBgQDeTQy4b8i+TAX/PmUf\nRmMakFesi5l6IubUUGQIa7dFrgVICZArvz5HZmPkyPTJQFyXOYH4vN6LNhDmxGy1\n/cOPXCYjbmhtIgpMzdcaOMB8phNV/MbtpLe5xDoEA79tYT06LlO4KMI8BnVmKm9W\nuSgX58HTrXVKwioOBE6NHafXVg==\n-----END PRIVATE KEY-----\n',
  });
  await doc.loadInfo();
  console.log('Подключено к Google Sheets!');
}
auth();

// Команда /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, `Привет! Я твой трекер привычек. Вот что я умею:`, {
    reply_markup: {
      keyboard: [['➕ Добавить привычку'], ['📊 Мой прогресс']],
      resize_keyboard: true,
    },
  });
});

// Добавление привычки
bot.onText(/➕ Добавить привычку/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Напиши название привычки:');
  bot.once('message', async (msg) => {
    const habitsSheet = doc.sheetsByTitle['Habits'];
    await habitsSheet.addRow({
      user_id: msg.chat.id,
      habit_name: msg.text,
      created_at: new Date(),
    });
    bot.sendMessage(msg.chat.id, `✅ Привычка "${msg.text}" добавлена!`);
  });
});

// Прогресс за месяц
bot.onText(/📊 Мой прогресс/, async (msg) => {
  const historySheet = doc.sheetsByTitle['History'];
  const rows = await historySheet.getRows();
  const userRows = rows.filter(row => row.user_id == msg.chat.id);

  let message = `📅 Твой прогресс:\n`;
  userRows.forEach(row => {
    message += `${row.habit_name} (${row.date}): ${row.status}\n`;
  });

  bot.sendMessage(msg.chat.id, message || 'Ты еще не отмечал привычки!');
});