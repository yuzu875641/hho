"use strict";
const express = require("express");
let app = express();
const bodyParser = require("body-parser");
const { createClient } = require('@supabase/supabase-js');
const { DateTime } = require('luxon');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const https = require('https');

const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

const CHATWORK_API_TOKEN = process.env.CHATWORK_API_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const BOT_ACCOUNT_ID = '10617115'; // BotのIDを直接設定
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
  "welcomedelete": welcomedelete,
  "削除": deleteMessages,
  "ars": arasitaisaku,
  "retrust": retrust
};

app.get("/", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const data = req.body;
  const messageBody = data.webhook_event.body;
  const roomId = data.webhook_event.room_id;
  const messageId = data.webhook_event.message_id;
  const accountId = data.webhook_event.account_id;

  if (accountId.toString() === BOT_ACCOUNT_ID) {
    return;
  }

  if (data.webhook_setting_id) {
    console.log("Webhook test successful.");
    return;
  }
  
  if (zalgoPattern.test(messageBody)) {
    kick(roomId, accountId);
    return;
  }

  const cleanMessageBody = messageBody.replace(/^\[To:\d+\]さん\n/, '');
  const match = cleanMessageBody.match(/\/(\w+)\//);
  if (match) {
    const commandName = match[1];
    const command = commands[commandName];
    if (command) {
      await command(cleanMessageBody, cleanMessageBody.replace(/\//g, ''), messageId, roomId, accountId);
    } else {
      sendMessageToChatwork(roomId, messageId, "存在しないコマンドです", accountId);
    }
  }
});

app.post("/getchat", async (req, res) => {
  res.sendStatus(200);
  const data = req.body;
  const roomId = data.webhook_event.room_id;
  const accountId = data.webhook_event.account_id;
  const messageBody = data.webhook_event.body;
  const messageId = data.webhook_event.message_id;
  
  if (accountId.toString() === BOT_ACCOUNT_ID) {
    return;
  }

  if (data.webhook_setting_id) {
    console.log("Webhook test successful.");
    return;
  }
  
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
        komikuji(messageBody, "", messageId, roomId, accountId);
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

async function wakamehelp(body, message, messageId, roomId, accountId) {
  const helpMessage = `
---
ゆずbotのコマンドリスト
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
/削除/ - 過去のメッセージを削除します
/ars/ - 荒らし対策フィルターのON/OFF
/retrust/ - 閲覧のみユーザーを元に戻します
\`\`\`
  `;
  await sendMessageToChatwork(roomId, messageId, helpMessage, accountId);
}

async function isUserAdmin(accountId, roomId) {
  try {
    const response = await axios.get(`https://api.chatwork.com/v2/rooms/${roomId}/members`, {
      headers: {
        'X-ChatWorkToken': CHATWORK_API_TOKEN
      }
    });
    const member = response.data.find(m => m.account_id === accountId);
    return member && member.role === 'admin';
  } catch (error) {
    console.error('管理者チェックエラー:', error);
    return false;
  }
}

async function checkGijiAdmin(roomId, accountId) {
  try {
    const { data, error } = await supabase
      .from('room_admins')
      .select('accountid')
      .eq('roomid', roomId)
      .eq('accountid', accountId)
      .single();
    return !!data;
  } catch (error) {
    console.error("擬似管理者チェックエラー:", error.message);
    return false;
  }
}

async function checkPermission(roomId, accountId, messageId) {
  const isAdmin = await isUserAdmin(accountId, roomId);
  const isGijiAdmin = await checkGijiAdmin(roomId, accountId);
  if (!isAdmin && !isGijiAdmin) {
    await sendMessageToChatwork(roomId, messageId, "管理者または擬似管理者権限がありません", accountId);
    return false;
  }
  return true;
}

async function addAdmin(body, args, messageId, roomId, accountId) {
  if (!await checkPermission(roomId, accountId, messageId)) return;
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

async function removeAdmin(body, args, messageId, roomId, accountId) {
  if (!await checkPermission(roomId, accountId, messageId)) return;
  const targetAccountId = args;
  if (!targetAccountId) {
    sendMessageToChatwork(roomId, messageId, "アカウントIDを指定してください", accountId);
    return;
  }
  try {
    const { error: deleteError } = await supabase
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

async function gijiAdminList(body, args, messageId, roomId, accountId) {
  if (!await checkPermission(roomId, accountId, messageId)) return;
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

async function kickMember(body, args, messageId, roomId, accountId) {
  if (!await checkPermission(roomId, accountId, messageId)) return;
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

async function say(body, args, messageId, roomId, accountId) {
  const message = args.trim();
  if (!message) {
    sendMessageToChatwork(roomId, messageId, "メッセージを入力してください", accountId);
    return;
  }
  sendMessageToChatwork(roomId, messageId, message, accountId);
}

async function komikuji(body, args, messageId, roomId, accountId) {
  const omikujiList = ["大吉", "吉", "中吉", "小吉", "末吉", "凶", "大凶"];
  const result = omikujiList[Math.floor(Math.random() * omikujiList.length)];
  sendMessageToChatwork(roomId, messageId, `おみくじの結果は...${result}でした！`, accountId);
}

async function save(body, args, messageId, roomId, accountId) {
  if (!await checkPermission(roomId, accountId, messageId)) return;
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

async function deleteData(body, args, messageId, roomId, accountId) {
  if (!await checkPermission(roomId, accountId, messageId)) return;
  const triggerMessage = args.trim();
  if (!triggerMessage) {
    sendMessageToChatwork(roomId, messageId, "削除するトリガーを指定してください", accountId);
    return;
  }
  try {
    const { error: deleteError } = await supabase
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

async function Settings(body, args, messageId, roomId, accountId) {
  if (!await checkPermission(roomId, accountId, messageId)) return;
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

async function RandomMember(body, args, messageId, roomId, accountId) {
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

async function sendFile(body, args, messageId, roomId, accountId) {
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

    await axios.post(uploadUrl, formData, { headers });
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

async function welcomesave(body, args, messageId, roomId, accountId) {
  if (!await checkPermission(roomId, accountId, messageId)) return;
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
    if (selectError && selectError.code !== 'PGRST116') throw selectError; 
    
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

async function welcomedelete(body, args, messageId, roomId, accountId) {
  if (!await checkPermission(roomId, accountId, messageId)) return;
  try {
    const { error: deleteError } = await supabase
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
    const ms = `[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n${message}`;
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
async function getChatworkMembers(roomId) {
  try {
    const response = await axios.get(
      `https://api.chatwork.com/v2/rooms/${roomId}/members`,
      {
        headers: {
          "X-ChatWorkToken": CHATWORK_API_TOKEN,
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error(
      "Error fetching Chatwork members:",
      error.response?.data || error.message
    );
    return null;
  }
}

async function deleteMessages(body, message, messageId, roomId, accountId) {
  const isGijiAdmin = await checkGijiAdmin(roomId, accountId);
  const isAdmin = await isUserAdmin(accountId, roomId);
  if (!isGijiAdmin && !isAdmin) {
    sendMessageToChatwork(roomId, messageId, "管理者権限がありません", accountId);
    return;
  }

  const dlmessageIds = body.match(/(?<=to=\d+-)(\d+)/g);
  if (!dlmessageIds) {
    sendMessageToChatwork(roomId, messageId, "削除するメッセージを指定してください。", accountId);
    return;
  }

  for (const msgId of dlmessageIds) {
    try {
      await axios.delete(`https://api.chatwork.com/v2/rooms/${roomId}/messages/${msgId}`, {
        headers: {
          'x-chatworktoken': CHATWORK_API_TOKEN,
        },
      });
      console.log(`メッセージID ${msgId} を削除しました。`);
    } catch (err) {
      console.error(`メッセージID ${msgId} の削除に失敗しました:`, err.response?.data || err.message);
      sendMessageToChatwork(roomId, messageId, `メッセージID ${msgId} の削除に失敗しました。`, accountId);
    }
  }
  sendMessageToChatwork(roomId, messageId, "指定されたメッセージの削除を試行しました。", accountId);
}
async function arasitaisaku(body, message, messageId, roomId, accountId) {
  const isGijiAdmin = await checkGijiAdmin(roomId, accountId);
  const isAdmin = await isUserAdmin(accountId, roomId);
  if (!isGijiAdmin && !isAdmin) {
    sendMessageToChatwork(roomId, messageId, "管理者権限がありません", accountId);
    return;
  }
  try {
    const { data, error } = await supabase
      .from('arashi_rooms')
      .select('roomid')
      .eq('roomid', roomId);
    if (error) throw error;
    if (data.length === 0) {
      const { error: insertError } = await supabase
        .from('arashi_rooms')
        .insert([{ roomid: roomId }]);
      if (insertError) throw insertError;
      sendMessageToChatwork(roomId, messageId, "荒らし対策フィルターをONにしました。", accountId);
    } else {
      const { error: deleteError } = await supabase
        .from('arashi_rooms')
        .delete()
        .eq('roomid', roomId);
      if (deleteError) throw deleteError;
      sendMessageToChatwork(roomId, messageId, "荒らし対策フィルターをOFFにしました。", accountId);
    }
  } catch (err) {
    console.error('荒らし対策設定エラー:', err);
    sendMessageToChatwork(roomId, messageId, "荒らし対策設定中にエラーが発生しました。",accountId);
    }
  } catch (err) {
    console.error('荒らし対策設定エラー:', err);
    sendMessageToChatwork(roomId, messageId, "荒らし対策設定中にエラーが発生しました。", accountId);
  }
}
async function retrust(body, message, messageId, roomId, accountId) {
  const isGijiAdmin = await checkGijiAdmin(roomId, accountId);
  const isAdmin = await isUserAdmin(accountId, roomId);
  if (!isGijiAdmin && !isAdmin) {
    sendMessageToChatwork(roomId, messageId, "管理者権限がありません", accountId);
    return;
  }

  const targetAccountId = message;
  if (!targetAccountId) {
    sendMessageToChatwork(roomId, messageId, "アカウントIDを指定してください", accountId);
    return;
  }

  try {
    const members = await getChatworkMembers(roomId);
    let adminIds = members.filter(m => m.role === 'admin').map(m => m.account_id);
    let memberIds = members.filter(m => m.role === 'member').map(m => m.account_id);
    let readonlyIds = members.filter(m => m.role === 'readonly').map(m => m.account_id);
    
    if (readonlyIds.includes(parseInt(targetAccountId))) {
      memberIds.push(parseInt(targetAccountId));
      readonlyIds = readonlyIds.filter(id => id !== parseInt(targetAccountId));
      
      const encodedParams = new URLSearchParams();
      encodedParams.set('members_admin_ids', adminIds.join(','));
      encodedParams.set('members_member_ids', memberIds.join(','));
      encodedParams.set('members_readonly_ids', readonlyIds.join(','));

      const url = `https://api.chatwork.com/v2/rooms/${roomId}/members`;
      await axios.put(url, encodedParams.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-chatworktoken': CHATWORK_API_TOKEN,
        },
      });
      sendMessageToChatwork(roomId, messageId, `アカウントID ${targetAccountId} の権限を戻しました。`, accountId);
    } else {
      sendMessageToChatwork(roomId, messageId, `アカウントID ${targetAccountId} は閲覧のみではありません。`, accountId);
    }
  } catch (error) {
    console.error("権限変更エラー:", error.response?.data || error.message);
    sendMessageToChatwork(roomId, messageId, "権限変更中にエラーが発生しました。", accountId);
  }
}
