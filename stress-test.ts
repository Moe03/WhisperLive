import { WhisperLiveClient } from './whisper-live-client';
import * as path from 'path';

/**
 * Stress Test for WhisperLive TypeScript Client
 * 
 * This script runs 10 simultaneous transcription sessions to test
 * the server's ability to handle concurrent requests.
 * 
 * AUDIO FILE REQUIREMENTS:
 * - 16 kHz sample rate
 * - Mono (1 channel)  
 * - 16-bit PCM WAV format
 */

interface StressTestResult {
    clientId: number;
    success: boolean;
    startTime: number;
    endTime?: number;
    duration?: number;
    error?: string;
}

class StressTestRunner {
    private readonly numberOfClients: number;
    private readonly audioFile: string;
    private results: StressTestResult[] = [];
    private readonly clientConfig = {
        model: 'medium' as const,  // Using smaller model for better concurrency
        translate: false,
        useVad: false,
        logTranscription: false  // Disable individual logging to reduce noise
    };

    constructor(numberOfClients: number = 10, audioFile: string) {
        this.numberOfClients = numberOfClients;
        this.audioFile = audioFile;
    }

    async runSingleClient(clientId: number): Promise<StressTestResult> {
        const result: StressTestResult = {
            clientId,
            success: false,
            startTime: Date.now()
        };

        // Create timeout promise (3 minutes = 180 seconds)
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Client ${clientId} timed out after 3 minutes`));
            }, 180000); // 3 minutes in milliseconds
        });

        try {
            console.log(`🚀 Client ${clientId}: Starting transcription...`);
            
            const client = new WhisperLiveClient(this.clientConfig);
            
            // Race between the actual work and timeout
            await Promise.race([
                (async () => {
                    // Connect to server
                    await client.connect();
                    console.log(`✅ Client ${clientId}: Connected to server`);
                    
                    // Process audio file
                    await client.processAudioFile(this.audioFile);
                    
                    // Clean up
                    client.disconnect();
                })(),
                timeoutPromise
            ]);
            
            result.endTime = Date.now();
            result.duration = result.endTime - result.startTime;
            result.success = true;
            
            console.log(`🎉 Client ${clientId}: Completed in ${result.duration}ms`);
            
        } catch (error) {
            result.endTime = Date.now();
            result.duration = result.endTime - result.startTime;
            result.error = error instanceof Error ? error.message : String(error);
            
            console.log(`❌ Client ${clientId}: Failed after ${result.duration}ms - ${result.error}`);
        }

        return result;
    }

    async runStressTest(): Promise<void> {
        console.log('🔥 WhisperLive Stress Test');
        console.log('==========================');
        console.log(`📊 Running ${this.numberOfClients} concurrent transcriptions`);
        console.log(`🎵 Audio file: ${this.audioFile}`);
        console.log(`⏰ Start time: ${new Date().toISOString()}`);
        console.log(`⏱️ Maximum timeout: 3 minutes per client\n`);

        const startTime = Date.now();

        // Create global timeout promise for the entire test (3.5 minutes to allow cleanup)
        const globalTimeoutPromise = new Promise<StressTestResult[]>((_, reject) => {
            setTimeout(() => {
                reject(new Error('Entire stress test timed out after 3.5 minutes'));
            }, 210000); // 3.5 minutes in milliseconds
        });

        try {
            // Create all client promises
            const clientPromises: Promise<StressTestResult>[] = [];
            for (let i = 1; i <= this.numberOfClients; i++) {
                clientPromises.push(this.runSingleClient(i));
            }

            // Wait for all clients to complete (or fail)
            console.log(`⚡ Launching all ${this.numberOfClients} clients simultaneously...\n`);
            
            // Race between all clients completing and global timeout
            this.results = await Promise.race([
                Promise.all(clientPromises),
                globalTimeoutPromise
            ]);

            const totalTime = Date.now() - startTime;
            
            this.printResults(totalTime);
            
        } catch (error) {
            const totalTime = Date.now() - startTime;
            console.log(`\n💥 STRESS TEST INTERRUPTED`);
            console.log(`Total time before interruption: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
            console.log(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
            
            // Print whatever results we have so far
            if (this.results.length > 0) {
                this.printResults(totalTime);
            }
            throw error;
        }
    }

    private printResults(totalTime: number): void {
        const successful = this.results.filter(r => r.success);
        const failed = this.results.filter(r => !r.success);
        
        console.log('\n📈 STRESS TEST RESULTS');
        console.log('======================');
        console.log(`Total execution time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
        console.log(`Successful transcriptions: ${successful.length}/${this.numberOfClients}`);
        console.log(`Failed transcriptions: ${failed.length}/${this.numberOfClients}`);
        console.log(`Success rate: ${((successful.length / this.numberOfClients) * 100).toFixed(1)}%`);

        if (successful.length > 0) {
            const durations = successful.map(r => r.duration!);
            const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
            const minDuration = Math.min(...durations);
            const maxDuration = Math.max(...durations);
            
            console.log(`\n⏱️  TIMING STATISTICS (successful clients only):`);
            console.log(`Average duration: ${avgDuration.toFixed(0)}ms`);
            console.log(`Fastest client: ${minDuration}ms`);
            console.log(`Slowest client: ${maxDuration}ms`);
        }

        console.log('\n📋 DETAILED RESULTS:');
        console.log('Client | Status    | Duration | Error');
        console.log('-------|-----------|----------|------');
        
        this.results.forEach(result => {
            const status = result.success ? '✅ Success' : '❌ Failed ';
            const duration = result.duration ? `${result.duration}ms` : 'N/A';
            const error = result.error ? result.error.substring(0, 30) + '...' : '';
            
            console.log(`${result.clientId.toString().padStart(6)} | ${status} | ${duration.padStart(8)} | ${error}`);
        });

        if (failed.length > 0) {
            console.log('\n🔍 FAILURE ANALYSIS:');
            const errorCounts = new Map<string, number>();
            failed.forEach(result => {
                let errorType = 'Unknown';
                if (result.error) {
                    if (result.error.includes('timed out')) {
                        errorType = 'Timeout';
                    } else if (result.error.includes('WebSocket')) {
                        errorType = 'WebSocket Error';
                    } else if (result.error.includes('Server is not available')) {
                        errorType = 'Server Unavailable';
                    } else {
                        errorType = result.error.split(':')[0];
                    }
                }
                errorCounts.set(errorType, (errorCounts.get(errorType) || 0) + 1);
            });

            errorCounts.forEach((count, error) => {
                console.log(`  ${error}: ${count} occurrences`);
            });
        }

        console.log('\n💡 RECOMMENDATIONS:');
        if (successful.length === this.numberOfClients) {
            console.log('🎉 Excellent! Your server handled all concurrent requests successfully.');
        } else if (successful.length >= this.numberOfClients * 0.8) {
            console.log('⚠️  Good performance, but some failures occurred. Check server resources.');
        } else if (successful.length >= this.numberOfClients * 0.5) {
            console.log('🚨 Moderate performance. Consider optimizing server configuration.');
        } else {
            console.log('💥 Poor performance. Server may be overloaded or misconfigured.');
        }

        const timeoutFailures = failed.filter(r => r.error?.includes('timed out')).length;
        if (timeoutFailures > 0) {
            console.log(`⏰ Note: ${timeoutFailures} clients timed out after 3 minutes. Consider increasing timeout or checking server performance.`);
        }
    }
}

async function runStressTest() {
    const audioFile = path.join(__dirname, 'german_sample_16k.wav');
    
    // Check if audio file exists
    const fs = require('fs');
    if (!fs.existsSync(audioFile)) {
        console.error(`❌ Audio file not found: ${audioFile}`);
        console.log('\n💡 Make sure the german_sample_16k.wav file exists in the project directory.');
        process.exit(1);
    }

    try {
        const stressTest = new StressTestRunner(10, audioFile);
        await stressTest.runStressTest();
        
        console.log('\n🏁 Stress test completed!');
        console.log('Check the results above to assess your server\'s performance under load.\n');
        
    } catch (error) {
        console.error('💥 Stress test failed:', error);
        process.exit(1);
    }
}

// Run the stress test
if (require.main === module) {
    runStressTest().catch(console.error);
}

export { StressTestRunner, runStressTest };
