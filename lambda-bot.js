import { WebClient } from '@slack/web-api';
import { Configuration, OpenAIApi } from 'openai';
import crypto from 'crypto';

const slackClient  = new WebClient(process.env.SLACK_BOT_TOKEN);
const openaiConfig = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openaiClient = new OpenAIApi(openaiConfig);
const signingSecret = process.env.SLACK_SIGNING_SECRET;

export const handler = async (event, context) => {
    if (event.headers['x-slack-retry-num']) {
        return { statusCode: 200, body: JSON.stringify({ message: 'No need to resend' }) };
    }

    const timestamp = event.headers['x-slack-request-timestamp'];
    const signature = event.headers['x-slack-signature'];
    const eventBody = event.body;
    const body = JSON.parse(eventBody);
    const message = `v0:${timestamp}:${eventBody}`;
    const hmac = crypto.createHmac('sha256', signingSecret);
    hmac.update(message);
    const expectedSignature = `v0=${hmac.digest('hex')}`;
    
    const callDelay = Math.abs(Date.now() / 1000 - parseInt(timestamp));
    const signatureCheck = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))

    if (callDelay > 60 * 5 || !signatureCheck ){ 
        return { statusCode: 200, body: JSON.stringify({ message: 'No need to resend' }) };
    }

    const text = body.event.text.replace(/<@.*>/g, '');

    const openaiResponse = await createCompletion(text);

    const thread_ts = body.event.thread_ts || body.event.ts;
    await postMessage(body.event.channel, thread_ts, openaiResponse);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
};

async function createCompletion(text) {
    try {
        const response = await openaiClient.createChatCompletion({
          model: 'gpt-3.5-turbo',
          messages: [{role: 'user', content: text}],
        });
        return response.data.choices[0].message?.content;
    } catch(err) {
        console.error(err);
    }
}

async function postMessage(channel, thread_ts, text) {
    try {
        let payload = {
            channel: channel,
            thread_ts: thread_ts,
            text: text,
            as_user: true,
        };
        await slackClient.chat.postMessage(payload);
    } catch(err) {
        console.error(err);
    }
}
