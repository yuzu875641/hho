"use strict";
const express = require("express");
let app = express();
const bodyParser = require("body-parser");
const { createClient } = require('@supabase/supabase-js');
const { DateTime } = require('luxon');
const axios = require('axios');
const fs = require('fs');

const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

const CHATWORK_API_TOKEN = process.env.CHATWORK_API_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const zalgoPattern = /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/;

const commands = {
  "help": wakamehelp,
  "say": say,
  "おみくじ": komikuji,
  "save": save,
  "delete": deleteData,
  "setting": Settings,
  "member": RandomMember,
  "画像送ってみて": sendFile,
  "admin": addAdmin,
  "deladmin": removeAdmin,
  "adminlist": gijiAdminList,
  "kick": kickMember,
  "welcome": welcomesave,
  "welcomedelete": welcomedelete
};

app.get("/", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/webhook", (req, res) => {
  res.sendStatus(200);
  const data = req.body;
  if (data.webhook_setting_id) {
    console.log("Webhook test successful.");
    return;
  }
  const messageBody = data.webhook_event.body;
  const roomId = data.webhook_event.room_id;
  const messageId = data.webhook_event.message_id;
  const accountId = data.webhook_event.account_id;
  const name = data.webhook_event.pname;

  if (zalgoPattern.test(messageBody)) {
    kick(roomId, accountId);
    return;
  }

  const match = messageBody.match(/\/(\w+)\//);
  if (match) {
    const commandName = match[1];
    const command = commands[commandName];
    if (command) {
      command(roomId, messageId, messageBody.split(" ").slice(1).join(" "), accountId);
    } else {
      sendMessageToChatwork(roomId, messageId, "存在しないコマンドです", accountId);
    }
  }
});

app.post("/getchat", async (req, res) => {
  res.sendStatus(200);
  const data = req.body;
  if (data.webhook_setting_id) {
    console.log("Webhook test successful.");
    return;
  }
  const roomId = data.webhook_event.room_id;
  const accountId = data.webhook_event.account_id;
  const messageBody = data.webhook_event.body;
  const messageId = data.webhook_event.message_id;

  if (zalgoPattern.test(messageBody)) {
    kick(roomId, accountId);
    return;
  }

  try {
    const { data: textData, error: textError } = await supabase
      .from('text')
      .select('triggerMessage, responseMessage')
      .eq('roomid', roomId);
    if (textError) throw textError;

    if (textData && textData.length > 0) {
      for (const item of textData) {
        if (messageBody.includes(item.triggerMessage)) {
          sendMessageToChatwork(roomId, messageId, item.responseMessage, accountId);
          return;
        }
      }
    }
    if (messageBody.includes("おみくじ")) {
      const { data: omikujiLog, error } = await supabase
        .from('omikuji_log')
        .select('*')
        .eq('roomid', roomId)
        .eq('accountid', accountId)
        .gte('date', DateTime.now().setZone('Asia/Tokyo').startOf('day').toISODate());
      if (error) throw error;
      if (omikujiLog.length === 0) {
        komikuji(roomId, messageId, "", accountId);
        const { error: insertError } = await supabase
          .from('omikuji_log')
          .insert([{ roomid: roomId, accountid: accountId, date: DateTime.now().setZone('Asia/Tokyo').toISODate() }]);
        if (insertError) throw insertError;
      } else {
        sendMessageToChatwork(roomId, messageId, "おみくじは一日一回だよ！", accountId);
      }
    }
  } catch (error) {
    console.error("エラーが発生しました:", error.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

async function wakamehelp(roomId, messageId, args, accountId) {
  const helpMessage = `
---
ワカメbotのコマンドリスト
---
\`\`\`
/help/  - このコマンドリストを表示
/say/ [メッセージ] - 指定したメッセージをBotが送信
/おみくじ/ - おみくじを引く
/save/ [トリガー] [返信] - 特定の言葉に反応して返信する設定を保存
/delete/ [トリガー] - 設定を削除
/setting/ - 設定一覧を表示
/member/ - ランダムにメンバーを一人選ぶ
/画像送ってみて/ - どこかの画像をランダムに送信
/admin/ [アカウントID] - 擬似管理者を追加
/deladmin/ [アカウントID] - 擬似管理者を削除
/adminlist/ - 擬似管理者リストを表示
/kick/ [アカウントID] - ユーザーを閲覧のみの権限に変更
/welcome/ [メッセージ] - 新規参加者へのメッセージを保存
/welcomedelete/ - 新規参加者へのメッセージを削除
\`\`\`
  `;
  await sendMessageToChatwork(roomId, messageId, helpMessage, accountId);
}

async function isUserAdmin(accountId, roomId) {
  try {
    const { data: adminData, error: adminError } = await supabase
      .from('room_admins')
      .select('accountid')
      .eq('roomid', roomId)
      .eq('accountid', accountId);

    if (adminError) throw adminError;
    return adminData && adminData.length > 0;
  } catch (error) {
    console.error("管理者チェックエラー:", error.message);
    return false;
  }
}

async function checkAdmin(roomId, accountId, messageId) {
  const isAdmin = await isUserAdmin(accountId, roomId);
  if (!isAdmin) {
    await sendMessageToChatwork(roomId, messageId, "管理者権限がありません", accountId);
    return false;
  }
  return true;
}

async function addAdmin(roomId, messageId, args, accountId) {
  if (!await checkAdmin(roomId, accountId, messageId)) return;
  const targetAccountId = args;
  if (!targetAccountId) {
    sendMessageToChatwork(roomId, messageId, "アカウントIDを指定してください", accountId);
    return;
  }
  try {
    const { data: existingAdmin, error: selectError } = await supabase
      .from('room_admins')
      .select('accountid')
      .eq('roomid', roomId)
      .eq('accountid', targetAccountId)
      .single();
    if (existingAdmin) {
      sendMessageToChatwork(roomId, messageId, `アカウントID ${targetAccountId} はすでに管理者です`, accountId);
      return;
    }
    const { error: insertError } = await supabase
      .from('room_admins')
      .insert([{ roomid: roomId, accountid: targetAccountId }]);
    if (insertError) throw insertError;
    sendMessageToChatwork(roomId, messageId, `アカウントID ${targetAccountId} を管理者に追加しました`, accountId);
  } catch (error) {
    console.error("管理者追加エラー:", error.message);
    sendMessageToChatwork(roomId, messageId, "管理者追加中にエラーが発生しました", accountId);
  }
}

async function removeAdmin(roomId, messageId, args, accountId) {
  if (!await checkAdmin(roomId, accountId, messageId)) return;
  const targetAccountId = args;
  if (!targetAccountId) {
    sendMessageToChatwork(roomId, messageId, "アカウントIDを指定してください", accountId);
    return;
  }
  try {
    const { data, error: deleteError } = await supabase
      .from('room_admins')
      .delete()
      .eq('roomid', roomId)
      .eq('accountid', targetAccountId);
    if (deleteError) throw deleteError;
    sendMessageToChatwork(roomId, messageId, `アカウントID ${targetAccountId} を管理者から削除しました`, accountId);
  } catch (error) {
    console.error("管理者削除エラー:", error.message);
    sendMessageToChatwork(roomId, messageId, "管理者削除中にエラーが発生しました", accountId);
  }
}

async function gijiAdminList(roomId, messageId, args, accountId) {
  if (!await checkAdmin(roomId, accountId, messageId)) return;
  try {
    const { data, error } = await supabase
      .from('room_admins')
      .select('accountid')
      .eq('roomid', roomId);
    if (error) throw error;
    if (data.length === 0) {
      sendMessageToChatwork(roomId, messageId, "現在、擬似管理者は設定されていません", accountId);
      return;
    }
    const adminList = data.map(admin => admin.accountid).join(", ");
    sendMessageToChatwork(roomId, messageId, `擬似管理者リスト: ${adminList}`, accountId);
  } catch (error) {
    console.error("管理者リスト取得エラー:", error.message);
    sendMessageToChatwork(roomId, messageId, "管理者リストの取得中にエラーが発生しました", accountId);
  }
}

async function kickMember(roomId, messageId, args, accountId) {
  if (!await checkAdmin(roomId, accountId, messageId)) return;
  const targetAccountId = args;
  if (!targetAccountId) {
    sendMessageToChatwork(roomId, messageId, "アカウントIDを指定してください", accountId);
    return;
  }
  try {
    await axios.put(
      `https://api.chatwork.com/v2/rooms/${roomId}/members`,
      new URLSearchParams({ members_admin_ids: "", members_member_ids: "", members_readonly_ids: targetAccountId }),
      {
        headers: {
          "X-ChatWorkToken": CHATWORK_API_TOKEN,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    sendMessageToChatwork(roomId, messageId, `アカウントID ${targetAccountId} を閲覧のみにしました`, accountId);
  } catch (error) {
    console.error("キックエラー:", error.response?.data || error.message);
    sendMessageToChatwork(roomId, messageId, "キック中にエラーが発生しました", accountId);
  }
}

async function say(roomId, messageId, args, accountId) {
  const message = args;
  if (!message) {
    sendMessageToChatwork(roomId, messageId, "メッセージを入力してください", accountId);
    return;
  }
  sendMessageToChatwork(roomId, messageId, message, accountId);
}

async function komikuji(roomId, messageId, args, accountId) {
  const omikujiList = ["大吉", "吉", "中吉", "小吉", "末吉", "凶", "大凶"];
  const result = omikujiList[Math.floor(Math.random() * omikujiList.length)];
  sendMessageToChatwork(roomId, messageId, `おみくじの結果は...${result}でした！`, accountId);
}

async function save(roomId, messageId, args, accountId) {
  if (!await checkAdmin(roomId, accountId, messageId)) return;
  const [triggerMessage, ...responseParts] = args.split(" ");
  const responseMessage = responseParts.join(" ");
  if (!triggerMessage || !responseMessage) {
    sendMessageToChatwork(roomId, messageId, "トリガーと返信の両方を指定してください", accountId);
    return;
  }
  try {
    const { error: insertError } = await supabase
      .from('text')
      .insert([{ roomid: roomId, triggerMessage: triggerMessage, responseMessage: responseMessage }]);
    if (insertError) throw insertError;
    sendMessageToChatwork(roomId, messageId, `「${triggerMessage}」に反応して「${responseMessage}」と返信する設定を保存しました`, accountId);
  } catch (error) {
    console.error("設定保存エラー:", error.message);
    sendMessageToChatwork(roomId, messageId, "設定保存中にエラーが発生しました", accountId);
  }
}

async function deleteData(roomId, messageId, args, accountId) {
  if (!await checkAdmin(roomId, accountId, messageId)) return;
  const triggerMessage = args;
  if (!triggerMessage) {
    sendMessageToChatwork(roomId, messageId, "削除するトリガーを指定してください", accountId);
    return;
  }
  try {
    const { data, error: deleteError } = await supabase
      .from('text')
      .delete()
      .eq('roomid', roomId)
      .eq('triggerMessage', triggerMessage);
    if (deleteError) throw deleteError;
    sendMessageToChatwork(roomId, messageId, `トリガー「${triggerMessage}」の設定を削除しました`, accountId);
  } catch (error) {
    console.error("設定削除エラー:", error.message);
    sendMessageToChatwork(roomId, messageId, "設定削除中にエラーが発生しました", accountId);
  }
}

async function Settings(roomId, messageId, args, accountId) {
  if (!await checkAdmin(roomId, accountId, messageId)) return;
  try {
    const { data, error } = await supabase
      .from('text')
      .select('triggerMessage, responseMessage')
      .eq('roomid', roomId);
    if (error) throw error;
    if (data.length === 0) {
      sendMessageToChatwork(roomId, messageId, "現在、設定されている返信はありません", accountId);
      return;
    }
    const settingList = data.map(item => `トリガー: ${item.triggerMessage}, 返信: ${item.responseMessage}`).join("\n");
    sendMessageToChatwork(roomId, messageId, `設定リスト:\n${settingList}`, accountId);
  } catch (error) {
    console.error("設定リスト取得エラー:", error.message);
    sendMessageToChatwork(roomId, messageId, "設定リストの取得中にエラーが発生しました", accountId);
  }
}

async function RandomMember(roomId, messageId, args, accountId) {
  try {
    const { data } = await axios.get(`https://api.chatwork.com/v2/rooms/${roomId}/members`, {
      headers: { "X-ChatWorkToken": CHATWORK_API_TOKEN },
    });
    const members = data;
    const randomMember = members[Math.floor(Math.random() * members.length)];
    sendMessageToChatwork(roomId, messageId, `今日のラッキーメンバーは...[To:${randomMember.account_id}]${randomMember.name}さん！`, accountId);
  } catch (error) {
    console.error("メンバー取得エラー:", error.response?.data || error.message);
    sendMessageToChatwork(roomId, messageId, "メンバーリストの取得中にエラーが発生しました", accountId);
  }
}

async function sendFile(roomId, messageId, args, accountId) {
  const imageUrl = "https://picsum.photos/400";
  const fileName = "random_image.jpg";
  const filePath = `./${fileName}`;
  const writer = fs.createWriteStream(filePath);

  try {
    const response = await axios({
      method: 'get',
      url: imageUrl,
      responseType: 'stream',
    });
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));

    const uploadUrl = `https://api.chatwork.com/v2/rooms/${roomId}/files`;
    const headers = {
      ...formData.getHeaders(),
      "X-ChatWorkToken": CHATWORK_API_TOKEN,
    };

    const res = await axios.post(uploadUrl, formData, { headers });
    fs.unlinkSync(filePath);
    sendMessageToChatwork(roomId, messageId, "画像を送信しました！", accountId);

  } catch (error) {
    console.error("画像送信エラー:", error.response?.data || error.message);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    sendMessageToChatwork(roomId, messageId, "画像送信中にエラーが発生しました", accountId);
  }
}

async function kick(roomId, accountId) {
  try {
    await axios.put(
      `https://api.chatwork.com/v2/rooms/${roomId}/members`,
      new URLSearchParams({ members_admin_ids: "", members_member_ids: "", members_readonly_ids: accountId }),
      {
        headers: {
          "X-ChatWorkToken": CHATWORK_API_TOKEN,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    console.log(`アカウントID ${accountId} を閲覧のみにしました`);
  } catch (error) {
    console.error("キックエラー:", error.response?.data || error.message);
  }
}

async function welcomesave(roomId, messageId, args, accountId) {
  if (!await checkAdmin(roomId, accountId, messageId)) return;
  const welcomems = args;
  if (!welcomems) {
    sendMessageToChatwork(roomId, messageId, "メッセージを入力してください", accountId);
    return;
  }
  try {
    const { data: existingWelcome, error: selectError } = await supabase
      .from('welcome')
      .select('welcomems')
      .eq('roomid', roomId)
      .single();
    if (existingWelcome) {
      const { error: updateError } = await supabase
        .from('welcome')
        .update({ welcomems: welcomems })
        .eq('roomid', roomId);
      if (updateError) throw updateError;
      sendMessageToChatwork(roomId, messageId, "新規参加者へのメッセージを更新しました", accountId);
    } else {
      const { error: insertError } = await supabase
        .from('welcome')
        .insert([{ roomid: roomId, welcomems: welcomems }]);
      if (insertError) throw insertError;
      sendMessageToChatwork(roomId, messageId, "新規参加者へのメッセージを保存しました", accountId);
    }
  } catch (error) {
    console.error("メッセージ保存エラー:", error.message);
    sendMessageToChatwork(roomId, messageId, "メッセージ保存中にエラーが発生しました", accountId);
  }
}

async function welcomedelete(roomId, messageId, args, accountId) {
  if (!await checkAdmin(roomId, accountId, messageId)) return;
  try {
    const { data, error: deleteError } = await supabase
      .from('welcome')
      .delete()
      .eq('roomid', roomId);
    if (deleteError) throw deleteError;
    sendMessageToChatwork(roomId, messageId, "新規参加者へのメッセージを削除しました", accountId);
  } catch (error) {
    console.error("メッセージ削除エラー:", error.message);
    sendMessageToChatwork(roomId, messageId, "メッセージ削除中にエラーが発生しました", accountId);
  }
}

async function sendMessageToChatwork(roomId, messageId, message, accountId) {
  try {
    const ms = `[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\\n${message}`;
    await axios.post(
      `https://api.chatwork.com/v2/rooms/${roomId}/messages`,
      new URLSearchParams({ body: ms }),
      {
        headers: {
          "X-ChatWorkToken": CHATWORK_API_TOKEN,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    console.log("メッセージ送信成功");
  } catch (error) {
    console.error("Chatworkへのメッセージ送信エラー:", error.response?.data || error.message);
  }
        }
