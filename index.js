'use strict';
const Promise = require('bluebird');
const chalk = require('chalk');
const AWS = require('aws-sdk');
const s3 = require('@monolambda/s3');

// Prefix message for console output
const cliPrefix = 'SyncS3Buckets: ';

class ServerlessSyncS3Buckets {
    constructor(serverless, options) {
        this.serverless = serverless;
        this.options = options;
        this.cli = this.serverless.cli;
        this.syncS3Buckets = this.serverless.service.custom.syncS3Buckets;
        this.servicePath = this.serverless.service.serverless.config.servicePath;
        this.commands = {
            syncToS3: {
                usage: 'Sync the local directory to your deployed s3 bucket',
                lifecycleEvents: [
                    'sync',
                ],
            },
            s3info: {
                usage: 'Fetches and prints out the deployed s3 buckets',
                lifecycleEvents: [
                    's3BucketInfo',
                ],
            },
            deleteFromS3: {
                usage: 'Deletes all files from your s3 bucket',
                lifecycleEvents: [
                    'rm',
                ],
            },
        };

        this.hooks = {
            // Run after the serverless event
            'after:deploy:deploy': () => Promise.bind(this).then(this.syncDirectory),
            //'before:remove:remove': () => Promise.bind(this).then(this.removeDirectory),
            'after:aws:info:displayStackOutputs': () => Promise.bind(this).then(this.s3BucketInfo),
            // Run when using commands
            'syncToS3:sync': () => Promise.bind(this).then(this.syncDirectory),
            's3info:s3BucketInfo': () => Promise.bind(this).then(this.s3BucketInfo),
            'deleteFromS3:rm': () => Promise.bind(this).then(this.removeDirectory),
        };
    }

    // Syncs the directory to the provided bucket
    syncDirectory() {
        return new Promise((resolve, reject) => {
            if (this.checkParameters(this.syncS3Buckets)) {
                this.consoleLog('Syncing content to s3 buckets...');
                const promises = Promise.each(this.syncS3Buckets, (param) => {
                    // Process each s3bucket parameter
                    return this.getParametersToProcess(param)
                        .then((bucket) => {
                            return this.syncBucket(bucket);
                        })
                });
                return Promise.all(promises).then(() => {
                    this.consoleLog('All buckets completed!');
                });
            } else {
                return resolve();
            }
        });
    }

    // Sync an individual S3 Bucket
    syncBucket(s) {
        return new Promise((resolve, reject) => {
            // this.consoleLog('...syncing content to ' + s.bucketName + ' ');
            // Configure s3 parameters
            const params = {
                maxAsyncS3: 5,
                localDir: this.servicePath + '/' + s.localDir,
                deleteRemoved: true,
                followSymlinks: false,
                s3Params: {
                    Bucket: s.bucketName,
                    Prefix: s.bucketPrefix
                }
            };

            // setup s3 client
            const uploader = this.client().uploadDir(params);

            // If the client errors, throw
            uploader.on('error', (err) => {
                // reject(err.name);
                throw err;
            });

            // As progress is made, print dots
            let percent = 0;
            uploader.on('progress', () => {
                if (uploader.progressTotal === 0) {
                    return;
                }
                let current = Math.round(uploader.progressAmount/uploader.progressTotal * 10) * 10;
                if (current > percent) {
                    percent = current;
                    this.cli.printDot();
                }
            });

            // When it ends, resolve
            uploader.on('end', () => {
                //this.consoleLog('done');
                this.cli.printDot();
                this.cli.consoleLog('');
                resolve('done');
            });
        });
    }

    // Query for information on s3 buckets in the cloudformation stack
    s3BucketInfo() {
        return new Promise((resolve, reject) => {
            this.getS3ResourcesInStack().then((resources) => {
                if (resources.length > 0) {
                    this.cli.consoleLog(`${chalk.yellow('s3 buckets:')}`);
                    Promise.map(resources, (resource) => {
                        this.cli.consoleLog(`${chalk.yellow('  ')}${chalk.yellow(resource.LogicalResourceId)}`+ ' : '
                            + resource.PhysicalResourceId );
                        resolve();
                    });
                }
                return resolve();
            });
        });
    }

    // Syncs the directory to the provided bucket
    removeDirectory() {
        // Check to see if we have parameters to process
        return new Promise((resolve, reject) => {
            if (this.checkParameters(this.syncS3Buckets)) {
                this.consoleLog('Removing content from s3 buckets...');
                const promises = Promise.map(this.syncS3Buckets, (param) => {
                    // Process each s3bucket parameter
                    return this.getParametersToProcess(param)
                        .then((bucket) => {
                            return this.removeFromBucket(bucket);
                        })
                });
                return Promise.all(promises).then(() => {
                    this.consoleLog('All buckets completed!');
                });
            } else {
                return resolve();
            }
        });
    }

    // Remove content form an individual S3 Bucket
    removeFromBucket(s) {
        return new Promise((resolve, reject) => {
            // this.consoleLog('...deleting files from ' + s.bucketName + ' ');
            // Configure s3 parameters
            const params = {
                Bucket: s.bucketName,
                Prefix: s.bucketPrefix
            };

            // setup s3 client
            const uploader = this.client().deleteDir(params);

            // If the client errors, throw
            uploader.on('error', (err) => {
                reject(err);
            });

            // As progress is made, print dots
            let percent = 0;
            uploader.on('progress', () => {
                if (uploader.progressTotal === 0) {
                    return;
                }
                let current = Math.round(uploader.progressAmount/uploader.progressTotal * 10) * 10;
                if (current > percent) {
                    percent = current;
                    this.cli.printDot();
                }
            });

            // When it ends, resolve
            uploader.on('end', () => {
                //this.consoleLog('done');
                this.cli.printDot();
                this.cli.consoleLog('');
                resolve('done');
            });
        });
    }

    // Determine whether we have parameters to process
    checkParametersEx() {
        return new Promise(
            (resolve, reject) => {
                if (!Array.isArray(this.syncS3Buckets)) {
                    reject('No SyncS3Buckets options to process.');
                } else {
                    resolve(this.syncS3Buckets);
                }
            }
        );
    }
    // Determine whether we have parameters to process
    checkParameters() {
        if (!Array.isArray(this.syncS3Buckets)) {
            this.consoleLog('No SyncS3Buckets options to process.');
            return false;
        } else {
            return true;
        }

    }


    // Output messages to CLI in our format
    consoleLog(message) {
        this.cli.consoleLog(`${cliPrefix}${chalk.yellow(message)}`);
    }

    // Generates the S3 client for the current region
    client() {
        const provider = this.serverless.getProvider('aws');
        return s3.createClient({
            s3Client: new AWS.S3({
                region: provider.getRegion(),
            })
        });
    }

    // Get s3 resources information in stack from cloudformation
    getS3ResourcesInStack() {
        const provider = this.serverless.getProvider('aws');
        const stackName = provider.naming.getStackName(this.options.stage);

        return provider
            .request(
                'CloudFormation',
                'listStackResources',
                { StackName: stackName },
                this.options.stage,
                this.options.region // eslint-disable-line comma-dangle
            )
            .then((result) => {
                const resources = result.StackResourceSummaries;
                // Return only s3 resources that are not the ServerlesDeploymentBucket
                return resources.filter(entry => (entry.ResourceType === 'AWS::S3::Bucket'
                    && entry.LogicalResourceId !== 'ServerlessDeploymentBucket'));
            });
    }

    // Get physical name of resource from cloudformation
    getPhysicalResourceName(s) {
        const provider = this.serverless.getProvider('aws');
        const stackName = provider.naming.getStackName(this.options.stage);

        return provider
            .request(
                'CloudFormation',
                'describeStackResources',
                { StackName: stackName, LogicalResourceId: s },
                this.options.stage,
                this.options.region // eslint-disable-line comma-dangle
            )
            .then((result) => {
                // return the value for the PhysicalResourceId
                // this.consoleLog('me =>' + result.StackResources[0].PhysicalResourceId);
                return result.StackResources[0].PhysicalResourceId;
            })
    }

    // Get a parameter set and ensure it is ready to process
    getParametersToProcess(s) {
        return new Promise(
            (resolve, reject) => {
                // Check to see if we have valid options
                if (!s.localDir) { // Always require localDir
                    // Require either bucketName or bucketRef
                    if (!s.hasOwnProperty('bucketName') || !s.hasOwnProperty('bucketRef')) {
                        reject('Invalid custom.SyncS3Buckets options');
                    }
                }
                // Check if optional option is available
                if (!s.hasOwnProperty('bucketPrefix')) {
                    s.bucketPrefix = '';
                }
                // Resolve bucketRef to actual bucket names from cloudformation
                if (s.hasOwnProperty('bucketRef')){
                    this.getPhysicalResourceName(s.bucketRef).then((bucketName) => {
                            s.bucketName = bucketName;
                            resolve(s);
                        })
                } else {
                    resolve(s);
                }
            }
        )
    }

}

module.exports = ServerlessSyncS3Buckets;