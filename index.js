const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType
} = require('discord.js');

const axios = require('axios');
const { google } = require('googleapis');

// =====================
// ENV / CONFIG
// =====================
// Put these in .env. Do not hardcode production tokens in this file.


const BOT_TOKEN        = process.env.BOT_TOKEN;
const CLIENT_ID        = process.env.CLIENT_ID;
const GUILD_ID         = process.env.GUILD_ID;
const FORUM_CHANNEL_ID = process.env.FORUM_CHANNEL_ID;
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;
const MONDAY_BOARD_ID  = process.env.MONDAY_BOARD_ID;
const OLLAMA_URL       = process.env.OLLAMA_URL;
const GOOGLE_KEY_FILE  = process.env.GOOGLE_KEY_FILE;
const QA_TEMPLATE_ID   = '1YqH-MDjEIsqoumKalPDJdfNHowZkXb9LJV0vz1a7nfU';
const RELEASE_TEMPLATE_ID = process.env.RELEASE_TEMPLATE_ID || '1JVl-8H7ZixfK2RfzD2J7WuT-LMlshqE536SRboXc7tI';
const RELEASE_PARENT_FOLDER_ID = process.env.RELEASE_PARENT_FOLDER_ID || '1ms8zjHKA-A6u8wLRn5IbWNvZ_AjKYcoX';

const SHEETS_ID        = '1S7q89SzQEQ90_GVEg47UXoCQk1kyY9kjkpAHQfDB_6Q';
const ROADMAP_TAB = 'ROADMAP 2026';
const VEHICLES_ROADMAP_TAB = 'VEHICLES ROADMAP';

if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID || !FORUM_CHANNEL_ID || !MONDAY_API_TOKEN || !GOOGLE_KEY_FILE) {
  console.warn('Missing one or more required .env values. Check BOT_TOKEN, CLIENT_ID, GUILD_ID, FORUM_CHANNEL_ID, MONDAY_API_TOKEN, GOOGLE_KEY_FILE.');
}

const ROADMAP_MONTHS = [
  { label: 'April 2026', value: 'April 2026' },
  { label: 'May 2026', value: 'May 2026' },
  { label: 'June 2026', value: 'June 2026' },
  { label: 'July 2026', value: 'July 2026' },
  { label: 'August 2026', value: 'August 2026' },
  { label: 'September 2026', value: 'September 2026' },
  { label: 'October 2026', value: 'October 2026' },
  { label: 'November 2026', value: 'November 2026' }
];

const FORUM_TAGS = [
  { id: '1361349264424435736', name: 'Needs review', emoji: '🟧' },
  { id: '1361349506662142163', name: 'Ready to merge', emoji: '🟦' },
  { id: '1361349574282838096', name: 'Requested changes', emoji: '🟥' },
  { id: '1361349635687321952', name: 'Merged / Done', emoji: '✅' },
  { id: '1362475234329886750', name: 'In review', emoji: '🟨' },
  { id: '1471904559743107224', name: 'WIP', emoji: '🔄' }
];

const GROUPS = [
  { id: 'group_mm21gqsg', name: 'Delivery Job | Playtest | May 15' },
  { id: 'group_mm21fyz9', name: 'Lego Batman - Due: May 1' },
  { id: 'group_mm1a28n8', name: 'James Design Tasks | 2026' },
  { id: 'group_mm0wsrvp', name: 'Telemetry Requests - Jinjin' },
  { id: 'group_mm2ph4sv', name: 'Anti-Exploit [Part 1] | May 5' },
  { id: 'group_mm213fpm', name: '[AB Test] AFK Area Payout - On Hold' }
];

const STATUS_EMOJI = {
  COMPLETE: '✅',
  'IN PROGRESS': '🟠',
  'IN REVIEW': '🔵',
  BLOCKED: '🔴',
  'NOT STARTED': '⬛',
  QA: '🟣',
  DISCUSS: '🩷'
};

const STATUS_ORDER = [
  'COMPLETE',
  'IN PROGRESS',
  'IN REVIEW',
  'BLOCKED',
  'NOT STARTED',
  'QA',
  'DISCUSS'
];

// =====================
// GOOGLE CLIENTS
// =====================
const auth = new google.auth.GoogleAuth({
  keyFile: GOOGLE_KEY_FILE,
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets.readonly'
  ]
});

const drive = google.drive({ version: 'v3', auth });
const docs = google.docs({ version: 'v1', auth });
const sheets = google.sheets({ version: 'v4', auth });

// =====================
// STATE
// =====================
const pendingSchedule = new Map();
const pendingPRs = new Map();
const pendingReleaseDocs = new Map();

// =====================
// HELPERS
// =====================
function buildBar(pct) {
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function splitDiscordMessage(text, maxLength = 1900) {
  const chunks = [];
  let current = '';

  for (const line of text.split('\n')) {
    if ((current + '\n' + line).length > maxLength) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current += current ? `\n${line}` : line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function chunkSelectOptions(options, size = 25) {
  const chunks = [];
  for (let i = 0; i < options.length; i += size) {
    chunks.push(options.slice(i, i + size));
  }
  return chunks;
}

function columnToNumber(col) {
  let num = 0;
  for (const char of col) {
    num = num * 26 + (char.charCodeAt(0) - 64);
  }
  return num;
}

// =====================
// GOOGLE DOC GENERATION
// =====================
async function generateQADoc(title, releaseDate, qaPlace, content) {
  const copy = await drive.files.copy({
    fileId: QA_TEMPLATE_ID,
    supportsAllDrives: true,
    requestBody: { name: `QA - ${title} - ${releaseDate}` }
  });

  const docId = copy.data.id;

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          replaceAllText: {
            containsText: { text: 'TITLE_NAME', matchCase: true },
            replaceText: title
          }
        },
        {
          replaceAllText: {
            containsText: { text: 'RELEASE_DATE', matchCase: true },
            replaceText: releaseDate
          }
        },
        {
          replaceAllText: {
            containsText: { text: 'QA_PLACE', matchCase: true },
            replaceText: qaPlace
          }
        },
        {
          replaceAllText: {
            containsText: { text: 'CONTENT', matchCase: true },
            replaceText: content
          }
        }
      ]
    }
  });

  return `https://docs.google.com/document/d/${docId}/edit`;
}

async function getReleaseFolders() {
  const response = await drive.files.list({
    q: `'${RELEASE_PARENT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    orderBy: 'name'
  });

  return response.data.files || [];
}

async function generateReleaseDoc(title, folderId) {
  const copy = await drive.files.copy({
    fileId: RELEASE_TEMPLATE_ID,
    supportsAllDrives: true,
    requestBody: {
      name: title,
      parents: [folderId]
    }
  });

  const docId = copy.data.id;

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          replaceAllText: {
            containsText: { text: 'TITLE_NAME', matchCase: true },
            replaceText: title
          }
        }
      ]
    }
  });

  return `https://docs.google.com/document/d/${docId}/edit`;
}

async function getSprintSummary(groupId) {
  const query = `
    query ($boardId: ID!, $groupId: String!) {
      boards(ids: [$boardId]) {
        groups(ids: [$groupId]) {
          title
          items_page(limit: 100) {
            items {
              name
              column_values(ids: ["color_mm20p2t0", "person"]) {
                id
                text
              }
              subitems {
                id
                name
              }
            }
          }
        }
      }
    }
  `;

  const response = await axios.post(
    'https://api.monday.com/v2',
    { query, variables: { boardId: String(MONDAY_BOARD_ID), groupId } },
    { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
  );

  const group = response.data.data.boards[0].groups[0];
  const items = group.items_page.items;
  const title = group.title;

  // Collect all subitem IDs
  const allSubitemIds = [];
  for (const item of items) {
    for (const sub of item.subitems || []) allSubitemIds.push(sub.id);
  }

  // Fetch subitem status + hours directly by ID (only way text column returns)
  const subitemDataMap = {};
  if (allSubitemIds.length > 0) {
    const subQuery = `
      query ($ids: [ID!]) {
        items(ids: $ids, limit: 500) {
          id
          column_values(ids: ["color_mm20p2t0", "text_mm2xzs9w"]) {
            id
            text
          }
        }
      }
    `;
    const subResponse = await axios.post(
      'https://api.monday.com/v2',
      { query: subQuery, variables: { ids: allSubitemIds } },
      { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
    );
    for (const subitem of subResponse.data.data.items) {
      subitemDataMap[subitem.id] = subitem.column_values;
    }
  }

  const parentSummaries = [];
  const overallSubtaskCounts = {};

  let totalSubtasks          = 0;
  let totalCompletedSubtasks = 0;
  let totalHours             = 0;
  let completedHours         = 0;

  for (const item of items) {
    const statusCol = item.column_values.find(c => c.id === 'color_mm20p2t0');
    const personCol = item.column_values.find(c => c.id === 'person');

    const rawParentStatus = statusCol?.text || 'NOT STARTED';
    const parentStatus    = rawParentStatus.trim().toUpperCase();
    const owner           = personCol?.text || 'Unassigned';

    const subitems      = item.subitems || [];
    const subtaskCounts = {};
    let completedSubtasks = 0;

    for (const subitem of subitems) {
      const cols         = subitemDataMap[subitem.id] || [];
      const subStatusCol = cols.find(c => c.id === 'color_mm20p2t0');
      const subHoursCol  = cols.find(c => c.id === 'text_mm2xzs9w');

      const rawSubStatus = subStatusCol?.text || 'NOT STARTED';
      const subStatus    = rawSubStatus.trim().toUpperCase();
      const hours        = parseFloat(subHoursCol?.text) || 0;

      subtaskCounts[subStatus]        = (subtaskCounts[subStatus] || 0) + 1;
      overallSubtaskCounts[subStatus] = (overallSubtaskCounts[subStatus] || 0) + 1;

      totalHours += hours;

      if (subStatus === 'COMPLETE') {
        completedSubtasks++;
        totalCompletedSubtasks++;
        completedHours += hours;
      }
    }

    const totalForParent = subitems.length;
    totalSubtasks       += totalForParent;

    const completionPct =
      totalForParent > 0
        ? Math.round((completedSubtasks / totalForParent) * 100)
        : parentStatus === 'COMPLETE' ? 100 : 0;

    parentSummaries.push({
      name: item.name,
      owner,
      parentStatus,
      totalSubtasks: totalForParent,
      completedSubtasks,
      completionPct,
      subtaskCounts
    });
  }

  const overallPct =
    totalSubtasks > 0
      ? Math.round((totalCompletedSubtasks / totalSubtasks) * 100)
      : Math.round(
          parentSummaries.reduce((sum, p) => sum + p.completionPct, 0) /
            Math.max(parentSummaries.length, 1)
        );

  const roundedTotal   = Math.round(totalHours * 10) / 10;
  const roundedDone    = Math.round(completedHours * 10) / 10;
  const remainingHours = Math.round((totalHours - completedHours) * 10) / 10;

  const overallStatusLines =
    totalSubtasks > 0
      ? STATUS_ORDER
          .filter(status => overallSubtaskCounts[status])
          .map(status => {
            const count = overallSubtaskCounts[status];
            const pct   = Math.round((count / totalSubtasks) * 100);
            const emoji = STATUS_EMOJI[status] || '⚪';
            return `${emoji} **${status}** — ${pct}% (${count}/${totalSubtasks})`;
          })
      : [];

  parentSummaries.sort((a, b) => b.completionPct - a.completionPct);

  const parentLines = parentSummaries.map(parent => {
    const bar = buildBar(parent.completionPct);

    if (parent.totalSubtasks === 0) {
      const emoji = STATUS_EMOJI[parent.parentStatus] || '⚪';
      return `${bar} **${parent.name}** — ${parent.completionPct}% | No subtasks | ${emoji} ${parent.parentStatus} — ${parent.owner}`;
    }

    return `${bar} **${parent.name}** — ${parent.completionPct}% | ${parent.completedSubtasks}/${parent.totalSubtasks} subtasks — ${parent.owner}`;
  });

  const mondayLink = `https://voldex-company.monday.com/boards/${MONDAY_BOARD_ID}`;

  return [
    `🚀 **[${title}](${mondayLink})**`,
    '',


    '📊 **Overall Completion**',
    `${buildBar(overallPct)} ✅ **${overallPct}% complete**`,



    totalSubtasks > 0
      ? `Based on **${totalCompletedSubtasks}/${totalSubtasks} completed subtasks**`
      : 'Based on parent task statuses',

    roundedTotal > 0
      ? `⏱️ **${remainingHours}h remaining** of ${roundedTotal}h total (${roundedDone}h done)`
      : '',

    overallStatusLines.join('\n'),
    '',



    '🗂️ **Parent Task Progress**',
    parentLines.join('\n')
  ].filter(Boolean).join('\n');
}
// =====================
// AI SUMMARY
// =====================
async function summarizeMessages(messages) {
  const response = await axios.post(OLLAMA_URL, {
    model: 'llama3',
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful assistant that summarizes Discord channel conversations. Be concise and highlight key topics, decisions, and action items.'
      },
      {
        role: 'user',
        content: `Here are today's messages from a Discord channel. Please summarize the key topics, decisions, and action items:\n\n${messages}`
      }
    ],
    stream: false
  });

  return response.data.message.content;
}

// =====================
// ROADMAP
// =====================
async function getRoadmap(selectedMonth) {
  const thisYear = 2026;
  const byMonthAndDate = {};
  const seen = new Set();

  const valuesRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEETS_ID,
    range: `'${ROADMAP_TAB}'`
  });

  const values = valuesRes.data.values || [];
  const dateRow = values[1] || [];

  for (let rowIdx = 8; rowIdx <= 20; rowIdx++) {
    const row = values[rowIdx] || [];

    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const feature = (row[colIdx] || '').toString().trim();
      if (!feature) continue;

      const normalized = feature.toLowerCase();

      if (normalized.match(/\b(19|20)\d{2}\b/) || normalized.includes(' | ')) continue;

      const dateStr = (dateRow[colIdx] || '').toString().trim();
      if (!dateStr) continue;

const cleanDate = dateStr
  .split('/')[0]
  .replace(/\[.*?\]/g, '') // removes anything like [Monday]
  .trim();      const parsed = new Date(`${cleanDate} ${thisYear}`);
      if (isNaN(parsed)) continue;

      const monthKey = parsed.toLocaleString('en-US', {
        month: 'long',
        year: 'numeric'
      });

      if (selectedMonth && monthKey !== selectedMonth) continue;

      const key = `${feature}-${dateStr}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (!byMonthAndDate[monthKey]) byMonthAndDate[monthKey] = {};
      if (!byMonthAndDate[monthKey][dateStr]) {
        byMonthAndDate[monthKey][dateStr] = [];
      }

      byMonthAndDate[monthKey][dateStr].push(feature);
    }
  }

  const VEHICLE_RANGE_START = 'SW';

  const vehicleRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEETS_ID,
    range: `'${VEHICLES_ROADMAP_TAB}'!SW5:XG20`
  });

  const vehicleValues = vehicleRes.data.values || [];

  const vehicleMonthMap = {
    [`April ${thisYear}`]: [
      { date: 'Apr 3', start: 'SW' },
      { date: 'Apr 10', start: 'TB' },
      { date: 'Apr 17', start: 'TG' },
      { date: 'Apr 24', start: 'TL' }
    ],
    [`May ${thisYear}`]: [
      { date: 'May 1', start: 'TV' },
      { date: 'May 8', start: 'UA' },
      { date: 'May 15', start: 'UF' },
      { date: 'May 22', start: 'UK' },
      { date: 'May 29', start: 'UP' }
    ],
    [`June ${thisYear}`]: [
      { date: 'Jun 5', start: 'UU' },
      { date: 'Jun 12', start: 'UZ' },
      { date: 'Jun 19', start: 'VE' },
      { date: 'Jun 26', start: 'VJ' }
    ],
    [`July ${thisYear}`]: [
      { date: 'Jul 3', start: 'VO' },
      { date: 'Jul 10', start: 'VT' },
      { date: 'Jul 17', start: 'VY' },
      { date: 'Jul 24', start: 'WD' },
      { date: 'Jul 31', start: 'WI' }
    ],
    [`August ${thisYear}`]: [
      { date: 'Aug 7', start: 'WN' },
      { date: 'Aug 14', start: 'WS' },
      { date: 'Aug 21', start: 'WX' },
      { date: 'Aug 28', start: 'XC' }
    ]
  };

  const monthBlocks = vehicleMonthMap[selectedMonth];

  if (monthBlocks) {
    if (!byMonthAndDate[selectedMonth]) {
      byMonthAndDate[selectedMonth] = {};
    }

    for (const week of monthBlocks) {
      const offset = columnToNumber(week.start) - columnToNumber(VEHICLE_RANGE_START);

      if (!byMonthAndDate[selectedMonth][week.date]) {
        byMonthAndDate[selectedMonth][week.date] = [];
      }

      for (const row of vehicleValues) {
        const name = (row[offset] || '').toString().trim();
        const type = (row[offset + 1] || '').toString().trim();

        if (!name) continue;

        const key = `vehicle-${name}-${type}-${week.date}`;
        if (seen.has(key)) continue;
        seen.add(key);

        byMonthAndDate[selectedMonth][week.date].push(
          type ? `🚗 ${name} | ${type}` : `🚗 ${name}`
        );
      }
    }
  }

  if (!Object.keys(byMonthAndDate).length || !byMonthAndDate[selectedMonth]) {
    return `📭 No roadmap items found for **${selectedMonth}**.`;
  }

  let message = `🗓️ **Roadmap: ${selectedMonth}**\n`;

  const sortedDates = Object.entries(byMonthAndDate[selectedMonth]).sort((a, b) => {
    return new Date(`${a[0]} ${thisYear}`) - new Date(`${b[0]} ${thisYear}`);
  });

  message += '\n━━━━━━━━━━━━━━━━━━━━━━\n';
  message += `📆 **${selectedMonth.toUpperCase()}**\n`;
  message += '━━━━━━━━━━━━━━━━━━━━━━\n';

  for (const [date, features] of sortedDates) {
    message += `\n**${date}**\n`;

    for (const feature of features) {
      message += `> • ${feature}\n`;
    }
  }

  return message;
}

// =====================
// SLASH COMMAND REGISTRATION
// =====================
const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

async function registerSlashCommands() {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: [
        {
          name: 'generate-qa',
          description: 'Generate a QA document in Google Drive',
          options: [
            { type: 3, name: 'title', description: 'QA Title', required: true },
            { type: 3, name: 'date', description: 'Release Date', required: true },
            { type: 3, name: 'place', description: 'QA Place', required: true },
            { type: 3, name: 'content', description: 'Content description', required: true }
          ]
        },
        {
          name: 'generate-release',
          description: 'Generate a release document in Google Drive',
          options: [
            { type: 3, name: 'title', description: 'Release doc title', required: true }
          ]
        },
        {
          name: 'get-pr',
          description: 'Create a PR review thread in the forum',
          options: [
            { type: 3, name: 'title', description: 'Thread title', required: true },
            { type: 3, name: 'link', description: 'The PR link', required: true },
            { type: 3, name: 'message', description: 'Additional message', required: false }
          ]
        },
        {
          name: 'sprint-summary',
          description: 'Get a sprint status summary from Monday.com'
        },
        {
          name: 'schedule-message',
          description: 'Schedule a message to be sent to a channel',
          options: [
            { type: 7, name: 'channel', description: 'Channel to send the message to', required: true },
            { type: 3, name: 'time', description: 'When to send, e.g. 2026-04-28 19:04', required: true },
            { type: 3, name: 'timezone', description: 'Timezone offset, e.g. -4 for EDT', required: false }
          ]
        },
        {
          name: 'summarize-channel',
          description: "Summarize today's messages from a channel using AI",
          options: [
            { type: 7, name: 'channel', description: 'Channel to summarize', required: true }
          ]
        },
        {
          name: 'roadmap',
          description: 'Show the roadmap by month'
        }
      ]
    });

    console.log('Slash commands registered!');
  } catch (err) {
    console.error('Failed to register slash commands:', err.response?.data || err);
  }
}

// =====================
// DISCORD CLIENT
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on('ready', () => {
  console.log(`Bot is online as ${client.user.tag}`);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled rejection:', error);
});

client.on('interactionCreate', async interaction => {
  // =====================
  // /generate-qa
  // =====================
  if (interaction.isChatInputCommand() && interaction.commandName === 'generate-qa') {
    try {
      await interaction.deferReply({ flags: 64 });

      const title = interaction.options.getString('title');
      const releaseDate = interaction.options.getString('date');
      const qaPlace = interaction.options.getString('place');
      const content = interaction.options.getString('content');

      const url = await generateQADoc(title, releaseDate, qaPlace, content);

      await interaction.editReply(`✅ QA doc created for **${title}**!\n🔗 ${url}`);
    } catch (err) {
      console.error(err.response?.data || err);

      try {
        await interaction.editReply('❌ Something went wrong creating the QA doc.');
      } catch (e) {
        console.error('Could not send error reply:', e);
      }
    }

    return;
  }

  // =====================
  // /generate-release
  // =====================
  if (interaction.isChatInputCommand() && interaction.commandName === 'generate-release') {
    try {
      await interaction.deferReply({ flags: 64 });

      const title = interaction.options.getString('title');
      const folders = await getReleaseFolders();

      if (!folders.length) {
        await interaction.editReply('❌ No folders found inside the release parent folder.');
        return;
      }

      pendingReleaseDocs.set(interaction.user.id, { title, folders });

      const folderOptions = folders.slice(0, 25).map(folder => ({
        label: folder.name.slice(0, 100),
        value: folder.id
      }));

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_release_folder')
        .setPlaceholder('Select a folder for this release doc')
        .addOptions(folderOptions);

      await interaction.editReply({
        content:
          folders.length > 25
            ? `📁 Select a folder for **${title}**. Showing the first 25 folders alphabetically.`
            : `📁 Select a folder for **${title}**:`,
        components: [new ActionRowBuilder().addComponents(selectMenu)]
      });
    } catch (err) {
      console.error('Generate release dropdown error:', err.response?.data || err);

      try {
        await interaction.editReply('❌ Something went wrong loading release folders.');
      } catch (e) {
        console.error('Could not send release folder error:', e);
      }
    }

    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'select_release_folder') {
    await interaction.deferUpdate();

    const pending = pendingReleaseDocs.get(interaction.user.id);

    if (!pending) {
      await interaction.editReply({
        content: '❌ Session expired, run /generate-release again.',
        components: []
      });
      return;
    }

    const folderId = interaction.values[0];
    const selectedFolder = pending.folders.find(folder => folder.id === folderId);

    try {
      const url = await generateReleaseDoc(pending.title, folderId);
      pendingReleaseDocs.delete(interaction.user.id);

      await interaction.editReply({
        content: `✅ Release doc created for **${pending.title}**${selectedFolder ? ` in **${selectedFolder.name}**` : ''}!\n🔗 ${url}`,
        components: []
      });
    } catch (err) {
      console.error('Generate release doc error:', err.response?.data || err);

      await interaction.editReply({
        content: '❌ Something went wrong creating the release doc.',
        components: []
      });
    }

    return;
  }

  // =====================
  // /get-pr
  // =====================
  if (interaction.isChatInputCommand() && interaction.commandName === 'get-pr') {
    const title = interaction.options.getString('title');
    const link = interaction.options.getString('link');
    const message = interaction.options.getString('message') || '';

    pendingPRs.set(interaction.user.id, {
      title,
      link,
      message
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_pr_tag')
      .setPlaceholder('Select a tag for this PR')
      .addOptions(
        FORUM_TAGS.map(tag => ({
          label: tag.name,
          value: tag.id,
          emoji: tag.emoji
        }))
      );

    await interaction.reply({
      content: `**${title}** — Pick a tag:`,
      components: [new ActionRowBuilder().addComponents(selectMenu)],
      flags: 64
    });

    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'select_pr_tag') {
    const pending = pendingPRs.get(interaction.user.id);

    if (!pending) {
      await interaction.reply({
        content: '❌ Session expired, run /get-pr again.',
        flags: 64
      });
      return;
    }

    await interaction.deferUpdate();

    const selectedTagId = interaction.values[0];
    const threadContent = pending.message
      ? `${pending.link}\n\n${pending.message}`
      : pending.link;

    try {
      const response = await axios.post(
        `https://discord.com/api/v10/channels/${FORUM_CHANNEL_ID}/threads`,
        {
          name: pending.title,
          applied_tags: [selectedTagId],
          message: { content: threadContent }
        },
        {
          headers: {
            Authorization: `Bot ${BOT_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      pendingPRs.delete(interaction.user.id);

      await interaction.editReply({
        content: `✅ PR thread created!\n🔗 https://discord.com/channels/${interaction.guildId}/${response.data.id}`,
        components: []
      });
    } catch (err) {
      console.error(err.response?.data || err);

      await interaction.editReply({
        content: '❌ Something went wrong creating the PR thread.',
        components: []
      });
    }

    return;
  }

  // =====================
  // /sprint-summary
  // =====================
  if (interaction.isChatInputCommand() && interaction.commandName === 'sprint-summary') {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_sprint_group')
      .setPlaceholder('Select a sprint / group')
      .addOptions(
        GROUPS.map(group => ({
          label: group.name,
          value: group.id
        }))
      );

    await interaction.reply({
      content: '🚀 Select a sprint to summarize:',
      components: [new ActionRowBuilder().addComponents(selectMenu)],
      flags: 64
    });

    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'select_sprint_group') {
    await interaction.deferUpdate();

    const groupId = interaction.values[0];

    try {
      const message = await getSprintSummary(groupId);
      const chunks = splitDiscordMessage(message);

      await interaction.editReply({
        content: chunks[0],
        components: []
      });

      for (const chunk of chunks.slice(1)) {
        await interaction.followUp({
          content: chunk,
          flags: 64
        });
      }
    } catch (err) {
      console.error(err.response?.data || err);

      await interaction.editReply({
        content: '❌ Something went wrong fetching the sprint summary.',
        components: []
      });
    }

    return;
  }

  // =====================
  // /schedule-message
  // =====================
  if (interaction.isChatInputCommand() && interaction.commandName === 'schedule-message') {
    const channel = interaction.options.getChannel('channel');
    const time = interaction.options.getString('time');
    const timezone = interaction.options.getString('timezone') || '-4';

    pendingSchedule.set(interaction.user.id, {
      channelId: channel.id,
      time,
      timezone
    });

    const modal = new ModalBuilder()
      .setCustomId('schedule_message_modal')
      .setTitle('Schedule a Message');

    const messageInput = new TextInputBuilder()
      .setCustomId('scheduled_message_content')
      .setLabel('Message')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Type your message here')
      .setRequired(true)
      .setMaxLength(2000);

    modal.addComponents(new ActionRowBuilder().addComponents(messageInput));

    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'schedule_message_modal') {
    try {
      const pending = pendingSchedule.get(interaction.user.id);

      if (!pending) {
        await interaction.reply({
          content: '❌ Session expired, run /schedule-message again.',
          flags: 64
        });
        return;
      }

      const message = interaction.fields.getTextInputValue('scheduled_message_content');
      const tzOffset = parseFloat(pending.timezone);

      const [datePart, timePart] = pending.time.split(' ');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hour, minute] = timePart.split(':').map(Number);

      const sendAt = Date.UTC(year, month - 1, day, hour - tzOffset, minute);

      if (isNaN(sendAt)) {
        await interaction.reply({
          content: '❌ Invalid time format. Use: `2026-04-28 19:04`',
          flags: 64
        });
        return;
      }

      if (sendAt <= Date.now()) {
        await interaction.reply({
          content: '❌ That time is in the past!',
          flags: 64
        });
        return;
      }

      const delay = sendAt - Date.now();

      setTimeout(async () => {
        try {
          const ch = await client.channels.fetch(pending.channelId);
          await ch.send(message);
        } catch (err) {
          console.error('Failed to send scheduled message:', err);
        }
      }, delay);

      pendingSchedule.delete(interaction.user.id);

      const readableTime = new Date(sendAt).toLocaleString('en-US', {
        timeZone: 'America/New_York'
      });

      await interaction.reply({
        content: `✅ Scheduled for **${readableTime} EDT** in <#${pending.channelId}>\n📝 Preview:\n${message}`,
        flags: 64
      });
    } catch (err) {
      console.error('Schedule modal error:', err);

      await interaction.reply({
        content: '❌ Something went wrong scheduling the message.',
        flags: 64
      });
    }

    return;
  }

  // =====================
  // /summarize-channel
  // =====================
  if (interaction.isChatInputCommand() && interaction.commandName === 'summarize-channel') {
    try {
      await interaction.deferReply();

      const channel = interaction.options.getChannel('channel');

      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.editReply('❌ Please select a text channel.');
        return;
      }

      const allMessages = await channel.messages.fetch({ limit: 25 });

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayMessages = allMessages
        .filter(
          message =>
            message.createdAt >= today &&
            !message.author.bot &&
            message.content &&
            message.content.trim() !== ''
        )
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(message => `[${message.author.username}]: ${message.content}`)
        .join('\n');

      if (!todayMessages) {
        await interaction.editReply('📭 No messages found in that channel today!');
        return;
      }

      await interaction.editReply('🤔 Analyzing messages...');

      const summary = await summarizeMessages(todayMessages);

      await interaction.editReply(`📋 **Summary of #${channel.name} today:**\n\n${summary}`);
    } catch (err) {
      console.error(err.response?.data || err);

      try {
        await interaction.editReply('❌ Something went wrong. Make sure Ollama is running!');
      } catch (e) {
        console.error('Could not send error reply:', e);
      }
    }

    return;
  }

  // =====================
  // /roadmap
  // =====================
  if (interaction.isChatInputCommand() && interaction.commandName === 'roadmap') {
    try {
      await interaction.deferReply({ flags: 64 });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_roadmap_month')
        .setPlaceholder('Select a roadmap month')
        .addOptions(ROADMAP_MONTHS);

      await interaction.editReply({
        content: '🗓️ Select a roadmap month:',
        components: [new ActionRowBuilder().addComponents(selectMenu)]
      });
    } catch (err) {
      console.error('Roadmap dropdown error:', err);
    }

    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'select_roadmap_month') {
    await interaction.deferUpdate();

    const selectedMonth = interaction.values[0];

    try {
      const message = await getRoadmap(selectedMonth);
      const chunks = splitDiscordMessage(message);

      await interaction.editReply({
        content: chunks[0],
        components: []
      });

      for (const chunk of chunks.slice(1)) {
        await interaction.followUp({
          content: chunk,
          flags: 64
        });
      }
    } catch (err) {
      console.error(err.response?.data || err);

      await interaction.editReply({
        content: '❌ Something went wrong fetching the roadmap.',
        components: []
      });
    }
  }
});

// =====================
// STARTUP
// =====================
registerSlashCommands();
client.login(BOT_TOKEN);
