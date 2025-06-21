import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
import path from "path";
import cron from "node-cron";

dotenv.config();

const TOKEN = process.env.BOT_TOKEN;

const DB_FILE = "./db.json";

const bot = new TelegramBot(TOKEN, { polling: true });

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = readDb();

function getTodayDate() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDayMonth(date) {
  const day = date.getDate();
  const month = date.toLocaleString("ru-RU", { month: "long" });
  return `${day} ${month}`;
}

// Формат для вывода дд.мм.гггг (используем при показе)
function formatDisplayDate(dateStr) {
  const d = new Date(dateStr);
  // d.toLocaleDateString с русской локалью выведет в нужном формате дд.мм.гггг
  return d.toLocaleDateString("ru-RU");
}

// Возвращаем массив дат за неделю (понедельник-воскресенье) или месяц (календарный), в формате ISO yyyy-mm-dd
function getPastDates(count, mode = "days") {
  const result = [];
  const now = new Date();

  if (mode === "month") {
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let i = 1; i <= daysInMonth; i++) {
      result.push(formatDate(new Date(year, month, i)));
    }
  } else if (mode === "week") {
    // день недели (в JS воскресенье=0), считаем с понедельника
    const dayOfWeek = now.getDay();
    const mondayOffset = (dayOfWeek + 6) % 7;
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - mondayOffset + i);
      result.push(formatDate(d));
    }
  } else {
    // просто последние count дней (на всякий)
    for (let i = 0; i < count; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      result.push(formatDate(d));
    }
  }
  return result;
}

// Прогрессбар длиннее (20 символов)
function calculateProgress(userData, dates) {
  const habits = userData.habits || [];
  const totalPossible = dates.length * habits.length;
  let completed = 0;
  dates.forEach((date) => {
    const done = userData.completed?.[date] || [];
    completed += done.filter((h) => habits.includes(h)).length;
  });
  const percent =
    totalPossible === 0 ? 0 : Math.round((completed / totalPossible) * 100);
  const filledLength = Math.round(percent / 5); // 20 chars total
  const bar = "▓".repeat(filledLength) + "░".repeat(20 - filledLength);
  return `${bar} ${percent}%`;
}

// Стейты ожидания ввода
const waitingForHabit = {};
const waitingForDateInput = {};
const waitingForRename = {}; // ждёт новое название
const habitToRename = {}; // временно сохраняем, какую привычку переименовываем
const userState = {}; // состояние меню (например progress и т.п.)

// Главная клавиатура
function mainKeyboard() {
  return {
    keyboard: [
      ["📋 Показать привычки"],
      ["➕ Добавить привычку", "✏️ Редактировать привычку"],
      ["🗑 Удалить привычку"],
      ["👁 Посмотреть прогресс"],
      ["📥 Выгрузить всю статистику"],
    ],

    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

// Клавиатура с одной кнопкой "Выйти"
function exitKeyboard() {
  return {
    keyboard: [["🔙 Выйти"]],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

// Показываем главное меню и обнуляем стейты
function showMainMenu(chatId) {
  waitingForHabit[chatId] = false;
  waitingForDateInput[chatId] = false;
  userState[chatId] = "main";
  bot.sendMessage(chatId, " Выбери действие:", {
    reply_markup: mainKeyboard(),
  });
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  db[chatId] = db[chatId] || { habits: [], completed: [], started: false };

  if (!db[chatId].started) {
    // Если не начинали — показываем кнопку "Начать"
    bot.sendMessage(chatId, "Привет! Нажми кнопку ниже, чтобы начать.", {
      reply_markup: {
        keyboard: [["🚀 Начать"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  } else {
    // Уже начинали — сразу главное меню
    showMainMenu(chatId);
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  db[chatId] = db[chatId] || { habits: [], completed: {}, started: false };

  if (!db[chatId].started) {
    // Если не начинали, ждем нажатия "Начать"
    if (text === "🚀 Начать") {
      db[chatId].started = true;
      writeDb(db);
      return showMainMenu(chatId);
    } else {
      // Если нажали что-то другое, напомним про кнопку
      return bot.sendMessage(
        chatId,
        'Пожалуйста, нажми кнопку "Начать", чтобы продолжить.',
        {
          reply_markup: {
            keyboard: [["🚀 Начать"]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
    }
  }

  // Приоритет: если нажали "Выйти" — всегда сбросить все и в главное меню
  if (text === "🔙 Выйти") {
    return showMainMenu(chatId);
  }

  if (text === "📥 Выгрузить всю статистику") {
    await sendFullYearStats(chatId);
  }

  // Если ждем название привычки
  if (waitingForHabit[chatId]) {
    const habitName = text.trim();
    if (!habitName)
      return bot.sendMessage(
        chatId,
        "Название привычки не может быть пустым.",
        { reply_markup: exitKeyboard() }
      );
    if (db[chatId].habits.includes(habitName))
      return bot.sendMessage(chatId, "Такая привычка уже есть.", {
        reply_markup: exitKeyboard(),
      });
    db[chatId].habits.push(habitName);
    writeDb(db);
    waitingForHabit[chatId] = false;
    return bot.sendMessage(chatId, `Привычка "${habitName}" добавлена!`, {
      reply_markup: mainKeyboard(),
    });
  }

  // Ждём новое название привычки
  if (waitingForRename[chatId]) {
    const newName = text.trim();
    const oldName = habitToRename[chatId];
    if (!newName)
      return bot.sendMessage(chatId, "Название не может быть пустым.", {
        reply_markup: exitKeyboard(),
      });
    if (db[chatId].habits.includes(newName))
      return bot.sendMessage(chatId, "Такая привычка уже есть.", {
        reply_markup: exitKeyboard(),
      });

    const habitIndex = db[chatId].habits.indexOf(oldName);
    if (habitIndex !== -1) {
      db[chatId].habits[habitIndex] = newName;

      // Обновим все записи в completed
      for (const date in db[chatId].completed) {
        const day = db[chatId].completed[date];
        const index = day.indexOf(oldName);
        if (index !== -1) {
          day[index] = newName;
        }
      }

      writeDb(db);
      bot.sendMessage(
        chatId,
        `Привычка "${oldName}" переименована в "${newName}".`,
        { reply_markup: mainKeyboard() }
      );
    } else {
      bot.sendMessage(chatId, "Ошибка: старая привычка не найдена.", {
        reply_markup: mainKeyboard(),
      });
    }

    waitingForRename[chatId] = false;
    habitToRename[chatId] = null;
    return;
  }

  // Если ждем ввод даты для просмотра прогресса
  if (waitingForDateInput[chatId]) {
    const parts = text.trim().split(".");
    if (parts.length !== 3)
      return bot.sendMessage(chatId, "Формат даты: дд.мм.гггг", {
        reply_markup: exitKeyboard(),
      });
    const [dd, mm, yyyy] = parts;
    const dateStr = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    const data = db[chatId];
    if (!data.completed[dateStr])
      return bot.sendMessage(chatId, `Нет данных за ${text}`, {
        reply_markup: exitKeyboard(),
      });
    const completed = data.completed[dateStr];
    let result = `Прогресс за ${text}:\n`;
    data.habits.forEach((h) => {
      result += `${completed.includes(h) ? "✅" : "⬜️"} ${h}\n`;
    });
    waitingForDateInput[chatId] = false;
    return bot.sendMessage(chatId, result, { reply_markup: mainKeyboard() });
  }

  // Функция формирования и отправки Excel
  async function sendFullYearStats(chatId) {
    const data = db[chatId];
    if (!data || !data.habits.length) {
      return bot.sendMessage(chatId, "У вас пока нет привычек для выгрузки.", {
        reply_markup: mainKeyboard(),
      });
    }

    const now = new Date();
    const year = now.getFullYear();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Статистика по месяцам");

    let currentRow = 1;

    for (let month = 0; month < 12; month++) {
      const monthName = new Date(year, month).toLocaleString("ru-RU", {
        month: "long",
      });

      // Вписываем название месяца (заголовок)
      sheet.getCell(currentRow, 1).value = monthName;
      sheet.getCell(currentRow, 1).font = { bold: true, size: 14 };
      currentRow++;

      // Заголовок таблицы: "Привычка", дни месяца
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const headerRow = ["Привычка"];
      for (let day = 1; day <= daysInMonth; day++) {
        headerRow.push(day.toString());
      }
      sheet.getRow(currentRow).values = headerRow;

      // Чуть расширим ширину столбца с привычками
      sheet.getColumn(1).width = 30;
      // Настроим ширину столбцов с датами и центрирование
      for (let col = 2; col <= daysInMonth + 1; col++) {
        sheet.getColumn(col).width = 3;
        sheet.getColumn(col).alignment = { horizontal: "center" };
      }

      currentRow++;

      // Заполняем строки с привычками
      data.habits.forEach((habit) => {
        const row = [habit];
        for (let day = 1; day <= daysInMonth; day++) {
          const dateStr = `${year}-${String(month + 1).padStart(
            2,
            "0"
          )}-${String(day).padStart(2, "0")}`;
          const doneOnDate = data.completed?.[dateStr] || [];
          row.push(doneOnDate.includes(habit) ? "✅" : "");
        }
        sheet.getRow(currentRow).values = row;
        currentRow++;
      });

      // Добавим пустую строку для разделения месяцев
      currentRow++;
    }

    const filePath = path.join("./", `stats_${chatId}_${year}.xlsx`);
    await workbook.xlsx.writeFile(filePath);

    await bot.sendDocument(
      chatId,
      filePath,
      {},
      {
        filename: `Статистика_${year}.xlsx`,
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }
    );

    fs.unlinkSync(filePath);
  }

  switch (text) {
    case "➕ Добавить привычку":
      waitingForHabit[chatId] = true;
      return bot.sendMessage(chatId, "Напиши название новой привычки.", {
        reply_markup: exitKeyboard(),
      });

    case "📋 Показать привычки": {
      const data = db[chatId];
      if (!data.habits.length)
        return bot.sendMessage(chatId, "Нет привычек.", {
          reply_markup: mainKeyboard(),
        });

      const today = getTodayDate();
      const completedToday = data.completed?.[today] || [];
      const buttons = data.habits.map((h) => [
        {
          text: (completedToday.includes(h) ? "✅ " : "⬜️ ") + h,
          callback_data: `toggle_${h}`,
        },
      ]);
      const weekDates = getPastDates(7, "week");
      const monthDates = getPastDates(null, "month");
      const week = calculateProgress(data, weekDates);
      const month = calculateProgress(data, monthDates);
      const todayFormatted = formatDayMonth(new Date());

      const messageText = `📅 Сегодня: ${todayFormatted}\n\n📊 Прогресс:\nЗа неделю: ${week}\nЗа месяц:  ${month}`;

      return bot.sendMessage(chatId, messageText, {
        reply_markup: {
          inline_keyboard: buttons,
        },
      });
    }

    case "✏️ Редактировать привычку": {
      const data = db[chatId];
      if (!data.habits.length)
        return bot.sendMessage(chatId, "Нет привычек для редактирования.", {
          reply_markup: mainKeyboard(),
        });

      const buttons = data.habits.map((h) => [
        {
          text: `✏️ ${h}`,
          callback_data: `rename_${h}`,
        },
      ]);

      bot.sendMessage(chatId, "Выбери привычку для редактирования:", {
        reply_markup: { inline_keyboard: buttons },
      });

      return bot.sendMessage(chatId, 'Если передумали, нажмите "Выйти".', {
        reply_markup: exitKeyboard(),
      });
    }

    case "🗑 Удалить привычку": {
      const data = db[chatId];
      if (!data.habits.length)
        return bot.sendMessage(chatId, "Нет привычек.", {
          reply_markup: mainKeyboard(),
        });
      const buttons = data.habits.map((h) => [
        {
          text: h,
          callback_data: `delete_${h}`,
        },
      ]);
      // Клавиатура замена на кнопку "Выйти"
      bot.sendMessage(chatId, "Выбери привычку для удаления:", {
        reply_markup: { inline_keyboard: buttons },
      });
      // Показать кнопку выйти ниже основного меню
      return bot.sendMessage(chatId, 'Если передумали, нажмите "Выйти"', {
        reply_markup: exitKeyboard(),
      });
    }

    case "👁 Посмотреть прогресс":
      userState[chatId] = "progress";
      return bot.sendMessage(chatId, "Выберите период:", {
        reply_markup: {
          keyboard: [
            ["📅 За неделю", "🗓 За месяц", "📆 За день"],
            ["🔙 Выйти"],
          ],
          resize_keyboard: true,
          one_time_keyboard: false,
        },
      });

    case "📅 За неделю":
      return sendVerticalStats(chatId, "week");

    case "🗓 За месяц":
      return sendVerticalStats(chatId, "month");

    case "📆 За день":
      waitingForDateInput[chatId] = true;
      return bot.sendMessage(chatId, "Введи дату в формате дд.мм.гггг:", {
        reply_markup: exitKeyboard(),
      });
  }
});

function sendVerticalStats(chatId, mode) {
  const data = db[chatId];
  const dates = getPastDates(null, mode);
  const habits = data.habits;

  if (habits.length === 0) {
    return bot.sendMessage(chatId, "Нет привычек.", {
      reply_markup: mainKeyboard(),
    });
  }

  let text = `Статистика за ${mode === "week" ? "неделю" : "месяц"}:\n\n`;

  dates.forEach((date) => {
    const done = data.completed?.[date] || [];
    const displayDate = formatDisplayDate(date);
    text += `📅 ${displayDate}\n`;
    habits.forEach((h) => {
      text += (done.includes(h) ? "✅" : "⬜️") + " " + h + "\n";
    });
    text += "\n"; // пустая строка между датами
  });

  bot.sendMessage(chatId, text, { reply_markup: exitKeyboard() });
}

function sendTable(chatId, mode) {
  const data = db[chatId];
  const dates = getPastDates(null, mode);
  const habits = data.habits;
  let text = `Статистика за ${mode === "week" ? "неделю" : "месяц"}:\n\n`;
  text += "Дата       " + habits.map((h) => h.slice(0, 5)).join(" | ") + "\n";
  dates.forEach((date) => {
    const done = data.completed?.[date] || [];
    const row = habits
      .map((h) => (done.includes(h) ? "✅" : "⬜️"))
      .join("   ");
    const displayDate = formatDisplayDate(date);
    text += `${displayDate} ${row}\n`;
  });
  bot.sendMessage(chatId, text, { reply_markup: exitKeyboard() });
}

bot.on("callback_query", (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const userData = db[chatId];
  userData.completed = userData.completed || {};

  // Приоритет для "Выйти" в callback - можно добавить, если нужно
  // (Но у тебя callback - это только toggle/delete, выхода там нет, т.к. кнопка выхода - обычная клавиатура)

  if (data.startsWith("toggle_")) {
    const habit = data.replace("toggle_", "");
    const today = getTodayDate();
    userData.completed[today] = userData.completed[today] || [];
    const idx = userData.completed[today].indexOf(habit);
    if (idx === -1) {
      userData.completed[today].push(habit);
    } else {
      userData.completed[today].splice(idx, 1);
    }
    writeDb(db);
    bot.answerCallbackQuery(query.id, `Обновлено: ${habit}`);

    // Кнопки привычек сегодня
    const todayCompleted = userData.completed[today];
    const buttons = userData.habits.map((h) => [
      {
        text: (todayCompleted.includes(h) ? "✅ " : "⬜️ ") + h,
        callback_data: `toggle_${h}`,
      },
    ]);

    // Пересчёт прогресса недели и месяца
    const weekDates = getPastDates(null, "week");
    const monthDates = getPastDates(null, "month");
    const weekProgress = calculateProgress(userData, weekDates);
    const monthProgress = calculateProgress(userData, monthDates);

    const newText = `📊 Прогресс:\nЗа неделю: ${weekProgress}\nЗа месяц:  ${monthProgress}`;

    // Обновляем и текст, и кнопки в сообщении
    bot.editMessageText(newText, {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  }

  if (data.startsWith("rename_")) {
    const habit = data.replace("rename_", "");
    waitingForRename[chatId] = true;
    habitToRename[chatId] = habit;
    bot.answerCallbackQuery(query.id);
    return bot.sendMessage(
      chatId,
      `Введи новое название для привычки "${habit}"`,
      { reply_markup: exitKeyboard() }
    );
  }

  if (data.startsWith("delete_")) {
    const habit = data.replace("delete_", "");
    const idx = userData.habits.indexOf(habit);
    if (idx !== -1) {
      userData.habits.splice(idx, 1);
      // Удалить выполнение привычки из completed по всем датам
      for (const date in userData.completed) {
        userData.completed[date] = userData.completed[date].filter(
          (h) => h !== habit
        );
      }
      writeDb(db);
      bot.answerCallbackQuery(query.id, `Привычка "${habit}" удалена`);
      // Обновить сообщение с кнопками удаления
      if (userData.habits.length === 0) {
        bot.editMessageText("Привычки отсутствуют.", {
          chat_id: chatId,
          message_id: query.message.message_id,
        });
      } else {
        const buttons = userData.habits.map((h) => [
          {
            text: h,
            callback_data: `delete_${h}`,
          },
        ]);
        bot.editMessageReplyMarkup(
          { inline_keyboard: buttons },
          { chat_id: chatId, message_id: query.message.message_id }
        );
      }
    } else {
      bot.answerCallbackQuery(query.id, "Привычка не найдена");
    }
  }
});

cron.schedule("30 7 * * *", () => {
  console.log("Отправка утренних привычек всем пользователям");

  for (const chatId in db) {
    const data = db[chatId];
    if (!data.habits || data.habits.length === 0) continue;

    const today = getTodayDate();
    const completedToday = data.completed?.[today] || [];
    const buttons = data.habits.map((h) => [
      {
        text: (completedToday.includes(h) ? "✅ " : "⬜️ ") + h,
        callback_data: `toggle_${h}`,
      },
    ]);
    const weekDates = getPastDates(7, "week");
    const monthDates = getPastDates(null, "month");
    const week = calculateProgress(data, weekDates);
    const month = calculateProgress(data, monthDates);
    const todayFormatted = formatDayMonth(new Date());

    const messageText = `📅 Сегодня: ${todayFormatted}\n\n📊 Прогресс:\nЗа неделю: ${week}\nЗа месяц:  ${month}`;

    bot.sendMessage(chatId, messageText, {
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  }
});
