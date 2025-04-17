import 'dotenv/config'; // loads environment variables from .env
import express from 'express';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

// 1) Extract env variables
const {
  AWS_REGION,
  AWS_ACCESS_KEY,
  AWS_SECRET_KEY,
  SQS_QUEUE_URL,
  PORT = 3000,
} = process.env;

// 2) Configure SQS Client
const sqsClient = new SQSClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY,
    secretAccessKey: AWS_SECRET_KEY,
  },
});

// 3) Create Express app
const app = express();
app.use(express.json());

// 4) POST endpoint to send data to SQS
app.post('/send', async (req, res) => {
  try {
    // The request body is the data you want to send to SQS
    const payload = JSON.stringify(req.body);

    const command = new SendMessageCommand({
      QueueUrl: SQS_QUEUE_URL,
      MessageBody: payload,
    });

    // 5) Send to SQS
    const response = await sqsClient.send(command);
    console.log('Sent SQS message with ID:', response.MessageId);

    // 6) Return success response
    res.status(200).json({ status: 'ok', messageId: response.MessageId });
  } catch (error) {
    console.error('Error sending SQS message:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7) Start the server
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
