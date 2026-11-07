/**
 * The deterministic topic selector (A-D16).
 */
import { topicsForConversation, topicsForText } from '../select';

describe('topicsForText', () => {
  it.each([
    ['What security risks need immediate attention?', ['security']],
    ['Are any CloudWatch alarms firing?', ['ops', 'telemetry']],
    ['What is the CPU utilization of my EC2 instances?', ['telemetry', 'inventory']],
    ['Which idle resources can I delete to save money?', ['cost', 'savings', 'inventory']],
    ['How did my spend compare to last month?', ['cost']],
    ['Which regions does DevControl scan?', ['regions']],
    ['How are our SOC 2 controls doing?', ['compliance']],
    ['What is our change failure rate?', ['delivery']],
    ['hello', []],
  ])('%s', (question, topics) => {
    expect(topicsForText(question)).toEqual(topics);
  });
});

describe('topicsForConversation', () => {
  it('combines the last 3 user turns, ignoring assistant turns', () => {
    const messages = [
      { role: 'user', content: 'What deployments failed?' },
      { role: 'assistant', content: 'Your security posture and alarms are fine' },
      { role: 'user', content: 'and my spend?' },
      { role: 'user', content: 'any alarms?' },
      { role: 'user', content: 'thanks' },
    ];
    expect(topicsForConversation(messages)).toEqual(['cost', 'ops']);
  });

  it('is the same every time for the same conversation', () => {
    const messages = [{ role: 'user', content: 'Security findings and CPU in us-east-1?' }];
    expect(topicsForConversation(messages)).toEqual(topicsForConversation(messages));
    expect(topicsForConversation(messages)).toEqual(['security', 'telemetry', 'regions']);
  });
});
