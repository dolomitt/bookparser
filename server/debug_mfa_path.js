import { spawn } from 'child_process';

// Debug script to find MFA installation path
async function findMFAPath() {
  console.log('=== Debugging MFA Path ===');
  
  // Check environment PATH
  console.log('PATH environment variable:');
  console.log(process.env.PATH);
  console.log('\n');
  
  // Try different commands to find MFA
  const commands = [
    'which mfa',
    'whereis mfa',
    'find /usr -name "mfa" 2>/dev/null',
    'find /opt -name "mfa" 2>/dev/null',
    'find /root -name "mfa" 2>/dev/null',
    'find /home -name "mfa" 2>/dev/null',
    'ls -la /root/miniconda3/bin/mfa',
    'ls -la /usr/local/bin/mfa',
    'ls -la /opt/conda/bin/mfa'
  ];
  
  for (const cmd of commands) {
    console.log(`Trying: ${cmd}`);
    try {
      const result = await runCommand(cmd);
      console.log(`✓ Result: ${result}`);
    } catch (error) {
      console.log(`✗ Failed: ${error.message}`);
    }
    console.log('');
  }
  
  // Try running MFA directly
  console.log('=== Testing MFA Commands ===');
  const mfaCommands = [
    'mfa version',
    '/root/miniconda3/bin/mfa version',
    'python -m montreal_forced_alignment version'
  ];
  
  for (const cmd of mfaCommands) {
    console.log(`Testing: ${cmd}`);
    try {
      const result = await runCommand(cmd);
      console.log(`✓ Success: ${result}`);
    } catch (error) {
      console.log(`✗ Failed: ${error.message}`);
    }
    console.log('');
  }
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    const parts = command.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);
    
    const proc = spawn(cmd, args, { 
      stdio: 'pipe', 
      shell: true,
      timeout: 5000 
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim() || stderr.trim());
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr.trim()}`));
      }
    });
    
    proc.on('error', (error) => {
      reject(error);
    });
  });
}

// Run the debug script
findMFAPath().catch(console.error);
