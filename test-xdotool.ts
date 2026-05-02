import { Sandbox } from '@e2b/desktop';
import 'dotenv/config';

async function run() {
  const sbx = await Sandbox.create();
  console.log("Created");
  let res = await sbx.commands.run('xdotool key alt+Tab');
  console.log('alt+Tab:', res);

  res = await sbx.commands.run('xdotool key alt+tab');
  console.log('alt+tab:', res);

  res = await sbx.commands.run('xdotool key Alt+Tab');
  console.log('Alt+Tab:', res);

  await sbx.kill();
}
run().catch(console.error);
