import 'dotenv/config'; // loads environment variables from .env
import express from 'express';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { CloudWatchLogsClient,
         CreateLogGroupCommand,
         CreateLogStreamCommand,
         PutLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { v4 as uuidv4 } from 'uuid';

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

// 2‑b) CloudWatch Logs client
const logsClient = new CloudWatchLogsClient({
    region: AWS_REGION,
    credentials: { accessKeyId: AWS_ACCESS_KEY, secretAccessKey: AWS_SECRET_KEY },
  });
  
  const { CWL_LOG_GROUP, CWL_LOG_STREAM = 'default' } = process.env;
  let sequenceToken;        // keep the rolling token in memory
  
  async function ensureLogGroupAndStream() {
    try {
      await logsClient.send(new CreateLogGroupCommand({ logGroupName: CWL_LOG_GROUP }));
    } catch (e) {
      if (e.name !== 'ResourceAlreadyExistsException') throw e;
    }
    try {
      await logsClient.send(
        new CreateLogStreamCommand({
          logGroupName: CWL_LOG_GROUP,
          logStreamName: CWL_LOG_STREAM,
        })
      );
    } catch (e) {
      if (e.name !== 'ResourceAlreadyExistsException') throw e;
    }
  }
  await ensureLogGroupAndStream();
  

  async function pushLog(event) {
    const params = {
      logGroupName: CWL_LOG_GROUP,
      logStreamName: CWL_LOG_STREAM,
      logEvents: [
        {
          timestamp: Date.now(),
          message: JSON.stringify(event),
        },
      ],
      sequenceToken,
    };
  
    const resp = await logsClient.send(new PutLogEventsCommand(params));
    sequenceToken = resp.nextSequenceToken;   // update for the next call
  }
  
// 3) Create Express app
const app = express();
app.use(express.json());

// 4) POST endpoint to send data to SQS
app.post('/send', async (req, res) => {
    const traceId      = req.body.traceId || uuidv4();
    const bodyWithTrace = { ...req.body, traceId };
    const payload       = JSON.stringify(bodyWithTrace);
  
    try {
      const command   = new SendMessageCommand({ QueueUrl: SQS_QUEUE_URL, MessageBody: payload });
      const { MessageId } = await sqsClient.send(command);
  
      const logEvent = {
        stage: 'NodeSender',
        traceId,
        sqsMessageId: MessageId,
        status: 'sent',
      };
      console.log(JSON.stringify(logEvent));       // local / stdout
      await pushLog(logEvent);                     // **CloudWatch**
  
      res.status(200).json({ status: 'ok', traceId, messageId: MessageId });
    } catch (err) {
      const errorEvent = { stage: 'NodeSender', traceId, error: err.message };
      console.error(JSON.stringify(errorEvent));
      await pushLog(errorEvent);                   // **CloudWatch**
  
      res.status(500).json({ error: 'SQS send failed', traceId });
    }
  });
  

// 7) Start the server
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
