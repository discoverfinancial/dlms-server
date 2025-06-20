import axios from "axios";
import fs from "fs";
import nodeCron from "node-cron";
import crypto from 'crypto';
import * as path from 'path';
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

export class DocClient {

    private url: string;
    private auth: any;
    private dir: string;
    private filesDir: string;
    private exportedUrl: string;

    // Default export filename
    public static mapFileExt: string = `export.json`;

    /**
     * Export document
     * 
     * @param fromUrl - Url of file to export
     * @param toDir - Directory file will be saved to
     * @param filesDir - Location of imported file 
     */
    public static async export(fromUrl: string, toDir: string, filesDir: string) {
        try {
            const dc = new DocClient(fromUrl, toDir, filesDir);
            await dc.doExport();
        } catch (e: any) {
            console.error(`ERROR: export from ${fromUrl} failed: ${e.stack}`);
        }
    }

    /**
     * Import document
     * 
     * @param fromDir - Dir of file to import
     * @param toUrl - Url where file will be imported to
     * @param reset - Flag for resetting the database before import
     */
    public static async import(fromDir: string, toUrl: string, reset: boolean) {
        try {
            const dc = new DocClient(toUrl, fromDir, `${fromDir}/../files`);
            await dc.doImport(reset);
        } catch (e: any) {
            console.error(`ERROR: import to ${toUrl} failed: ${e.stack}`);
        }
    }

    /**
     * Delete directory, making a backup in the process
     * 
     * @param backupDir - Directory to backup to 
     */
    public static async delete(backupDir: string) {
        try {
            const dc = new DocClient("", backupDir, `${backupDir}/../files`);
            await dc.doDelete();
        } catch (e: any) {
            console.error(`ERROR: delete of ${backupDir} failed: ${e.stack}`);
        }
    }
    
    constructor(url: string, dir: string, filesDir: string) {
        this.url = url;
        this.dir = dir;
        this.filesDir = filesDir;
        this.auth = {
            username: cfg("USER"),
            password: cfg("PASS"),
        };
        this.exportedUrl = "";
    }

    /**
     * Perform the export of documents from the source URL to the target directory.
     *
     * @summary
     * This method is responsible for exporting documents from the source URL (`this.fromUrl`)
     * to the target directory (`this.toDir`). It performs the following steps:
     *
     * 1. Checks if the target directory exists. If not, it creates the directory.
     * 2. Fetches the list of documents from the source URL.
     * 3. Iterates over the list of documents and performs the following actions for each document:
     *    - Checks if the document has already been exported by looking for its hash in the mapping file.
     *    - If the document has not been exported, it downloads the document from the source URL and saves it to the target directory.
     *    - Updates the mapping file with the document's ID and hash.
     * 4. Logs a message indicating the successful completion of the export process.
     *
     * @throws {Error} If an error occurs during the export process.
     */
    public async doExport() {
        if (fs.existsSync(this.dir)) {
           throwErr(`Export directory '${this.dir}' already exists`);
        }
        console.log(`Starting export from URL '${this.url}' to directory '${this.dir}'`);
        await fs.mkdirSync(this.dir);
        if (!fs.existsSync(this.filesDir)) {
            await fs.mkdirSync(this.filesDir);
        }
        await this.writeTextFile(this.exportedUrlFile(), this.url);
        const idsMap = await this.sendGet("export_ids");
        let idsHashMap = idsMap;
        for (const cName of Object.keys(idsMap)) {
            console.log(`Exporting collection ${cName}`);
            const ids = idsMap[cName];
            const hashArray = [];
            const idsLen = ids.length;
            let idsCount = 0;
            for (const id of ids) {
                if (idsCount % 100 == 0) {
                    console.log(`${idsCount} of ${idsLen}`)
                }
                //console.log(`Exporting entry ${id}`);
                const retryCount = 5;
                let count = retryCount; // retry count if failed
                while (count > 0) {
                    try {
                        const ele = await this.sendGet(`export/${cName}/${encodeURI(id)}`);
                        // create hash of file contents
                        const hash = getHash(ele);
                        const hashFileName = `${this.filesDir}/${hash}.json`;
                        hashArray.push({id: id, hash: hash});

                        // only backup this file if the exact same file is not already present
                        if (!fs.existsSync(hashFileName)) {
                            await this.writeFile(hashFileName,ele);
                        }

                        count = 0;
                    } catch (e: any) {
                        console.log("ERROR=", e);
                        console.log("  -- id=", id, "encoded=", encodeURI(id))
                        count--;
                        if (count == 0) {
                            console.error(`ERROR: export of ${id} from collection ${cName} failed ${retryCount-count} times: ${e.message}`);
                        }
                        else {
                            console.warn(`WARNING: export of ${id} from collection ${cName} failed ${retryCount-count} times: ${e.message}`);
                        }
                    }
                }
                idsCount++;
            }
            idsHashMap[cName] = hashArray;
        }

        await this.writeFile(this.mapFile(), idsHashMap)
        console.log(`Completed export from URL '${this.url}' to directory '${this.dir}'`);
    }

    /**
     * Import documents from the specified directory to the target URL.
     *
     * @summary
     * This method is responsible for importing documents from the directory specified
     * by `this.dir` to the target URL.
     *
     * @param {boolean} reset - A flag indicating whether to reset the target URL before importing.
     */
    public async doImport(reset: boolean) {
        if (!fs.existsSync(this.dir)) {
           throwErr(`Import directory '${this.dir}' does not exist`);
        }
        console.log(`Starting import from directory '${this.dir}' to URL '${this.url}'`);
        if (reset) {
            await this.sendGet("reset?simpleInit=true");
        }
        this.exportedUrl = await this.readTextFile(this.exportedUrlFile());
        const idsHashesMap: any = await this.readFile(this.mapFile());
        for (const cName of Object.keys(idsHashesMap)) {
            console.log(`Importing collection ${cName}`);
            const idWithHash = idsHashesMap[cName];
            const idsLen = idWithHash.length;
            let idsCount = 0;
            for (const {id,hash} of idWithHash) {
                console.log(`Importing entry ${idsCount} of ${idsLen}: ${id}`);
                const ele = await this.readFile(`${this.filesDir}/${hash}.json`);
                await this.sendPut(`import/${cName}/${encodeURI(id)}`,ele);
                idsCount++;
            }
        }
        console.log(`Completed import from directory '${this.dir}' to URL '${this.url}'`);
    }

    /**
     * Delete directory, making a backup in the process
     * 
     * @summary
     * This method is responsible for deleting the specified directory (`this.dir`).
     * Before deleting the directory.
     */
    public async doDelete() {
        if (!fs.existsSync(this.dir)) {
            throwErr(`Files directory '${this.dir}' does not exist`);
        }
        console.log(`Starting delete of directory '${this.dir}'`);
        const backupDir = path.dirname(this.dir)
        const idsHashesMap: any = await this.readFile(this.mapFile());
        var hashesPresent = []
        for (const cName of Object.keys(idsHashesMap)) {
            const idWithHash = idsHashesMap[cName];
            for (const {hash} of idWithHash) {
                hashesPresent.push(hash);
            }
        }

        // Check all other dirs for every hash file that could be deleted
        var dateDirs: string[] = []
        fs.readdirSync(backupDir).forEach(file => {
            if (file != "files") dateDirs.push(file);
        });
        var hashesFound: string[] = []
        for (const dateDir of dateDirs) {
            const fullDateDir = `${backupDir}/${dateDir}`
            if (fullDateDir == this.dir) continue;
            const  dateDirMap: any = await this.readFile(`${fullDateDir}/${DocClient.mapFileExt}`);
            for (const cName of Object.keys(dateDirMap)) {
                const idWithHash = dateDirMap[cName];
                for (const {hash} of idWithHash) {
                    if (!hashesFound.includes(hash)) hashesFound.push(hash)
                }
            }
        }
        for (const hash of hashesPresent) {
            if (!hashesFound.includes(hash)) {
                console.log(`${hash} not found in file - deleting...`)
                await fs.unlink(`${this.filesDir}/${hash}.json`, function(err) {
                    if (err) console.log(`error deleting ${hash}`)
                    else console.log(`${hash} deleted form all files`)
                });
            }
        }
        await fs.rmSync(this.dir, { recursive: true, force: true });
        console.log(`Completed delete of directory '${this.dir}'`);
    }

    /** Axios GET */
    private async sendGet(path: string): Promise<any> {
        return await this.sendAxios(path, {method: "GET"});
    }

    /** Axios POST */
    private async sendPost(path: string, body: object): Promise<any> {
        return await this.sendAxios(path, {method: "POST", data: body});
    }

    /** Axios PUT */
    private async sendPut(path: string, body: object): Promise<any> {
        return await this.sendAxios(path, {method: "PUT", data: body});
    }

    /**
     * Handler to send (POST) and get (GET) files using axios
     * 
     * @param path - Directory in which to create the file
     * @param opts - Options
     * @returns Axios response data 
     */
    private async sendAxios(path: string, opts?:any): Promise<any> {
        const url = this.makeUrl(path);
        opts = opts || {};
        opts.method = opts.method || "GET";
        opts.url = url;
        opts.auth = this.auth;
        opts.maxContentLength = 200000000;
        opts.maxBodyLength = 2000000000;
        opts.proxy = false;

        //console.log(`Sending ${opts.method} ${url} ...`);
        try {
           const resp = await axios(opts);
           const obj = resp.data;
           //console.log(`Response from ${opts.method} ${url}: ${JSON.stringify(obj,null,4)}`);
           return obj;
        } catch (e: any) {
            if (e.response?.data?.message == "request entity too large") {
                console.log("Request too large - continuing...")
            }
            else {
                throwErr(e.message);
            }
        }
    }

    /** 
     * Read text file content by file name
     * 
     * @param name - File name
     * @returns - Contents of file (if file exists and is read) or undefined
     */
    private async readTextFile(name: string) {
        const r = fs.readFileSync(name).toString();
        return r;
    }

    /** 
     * Write text file content by file name
     * 
     * @param name - File name
     * @param data - Data to write
     * @returns - Contents of file (if file exists and is read) or undefined
     */
    private async writeTextFile(name: string, data: string) {
        await fs.writeFileSync(name, data);
    }
 
    /**
     * Read file content by file name
     * 
     * @param name - File name
     * @returns - Contents of file (if file exists and is read) or undefined
     */
    private async readFile(name: string) {
        const r = fs.readFileSync(name).toString();
        const re = new RegExp(this.exportedUrl, "g")
        return JSON.parse(r.replace(re, this.url));
    }

    /** 
     * Write file content by file name
     * 
     * @param name - File name
     * @param obj - Data to write
     * @returns - Contents of file (if file exists and is read) or undefined
     */
    private async writeFile(name: string, obj: Object) {
       await fs.writeFileSync(name, JSON.stringify(obj));
    }

    /**
     * Map file location
     * 
     * @returns - File location
     */
    private mapFile() {
        return `${this.dir}/${DocClient.mapFileExt}`;
    }

    /**
     * Exported file
     * 
     * @returns - File location
     */
    private exportedUrlFile() {
        return `${this.dir}/exportedUrl.txt`;
    }

    private eleFile(cName: string, id: string) {
        return `${this.dir}/${cName}-${id}.json`;
    }

    /**
     * Make server url for specified path
     * 
     * @param path - Path provided
     * 
     * @returns - Server url
     */
    private makeUrl(path: string): string {
        if (path.startsWith("api")) {
            return `${this.url}/${path}`;
        }
        return `${this.url}/api/admin/${path}`;
    }

}

/** Ensure backup directory exists */
function verifyBackupSettings() {
    cfg("URL");
    let dir = cfg("BACKUP_DIR");
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
}

/** Run backup asynchronously */
async function runBackupDaemon() {
    await performBackup();
    setTimeout(runBackupDaemon, backupDelayInMs);
}

/** Do the backup */
async function performBackup() {
    try {
        const url = cfg("URL");
        let dir = cfg("BACKUP_DIR");
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir);
        }
        const filesDir = `${dir}/files`;
        dir = `${dir}/${dateStr()}`;
        await DocClient.export(url,dir,filesDir);
    } catch (e: any) {
        console.log(`${e.stack}`);
    }
}

// Date/time constants to be used below
const dayInMs = 24 * 60 * 60 * 1000;
const backupDelayInMs = process.env.BACKUP_DELAY ? parseInt(process.env.BACKUP_DELAY) : dayInMs;
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Build date string
 * 
 * @returns - Date string
 */
function dateStr() {
    const d = new Date();
    return `${monthNames[d.getMonth()]}-${d.getDate()}-${d.getFullYear()}_${d.getHours()}-${d.getMinutes()}-${d.getSeconds()}`;
}

/**
 * Create hash string
 * 
 * @param ele - anything to be used with making the hash string
 * 
 * @returns - Hash string
 */
function getHash(ele: any): string {
    const hashSum = crypto.createHash('sha256');
    hashSum.update(Buffer.from(JSON.stringify(ele)));
    return hashSum.digest("hex");
}

/**
 * Get configuration string based on the config name
 * 
 * @param name - config name 
 * @param def - default value if not found
 * @returns config
 */
function cfg(name: string, def?: string): string {
    const rtn = process.env[name];
    if (!rtn) {
        if (def) {
            return def;
        }
        return fatal(`${name} environment variable is not set`);
    }
    return rtn;
}

function throwErr(msg: string): never {
    throw new Error(msg);
}

function fatal(msg: string): never {
    console.error(`ERROR: ${msg}`);
    process.exit(1);
}

/**
 * Log current usage
 * 
 * @param msg
 */
function usage(msg?: string) {
    if (msg) {
        console.log(`Error: ${msg}`);
    }
    console.log(`Usage: node docClient export <fromUrl> <toDirectory>`)
    console.log(`                      import <fromDirectory> <toUrl> { merge | reset }`)
    console.log(`                      import <fromDirectory> <toUrl> { merge | reset }`)
    process.exit(1);
}

/**
 * Main function
 * 
 * @summary
 * Takes the process args and determines from when what the app
 * will do
 */
async function main() {
    const args = process.argv.slice(2);
    if (args.length == 0) {
        usage();
    }
    const cmd = args[0];

    // Export
    if (cmd === 'export') {
        if (args.length == 1) {
            const url = cfg("URL");
            let dir = cfg("BACKUP_DIR");
            if (url && dir) {
                const edir = `${dir}/${dateStr()}`;
                const filesDir = `${dir}/files`;
                await DocClient.export(url, edir, filesDir);
            }
            else {
                usage();
            }
        }
        else if (args.length != 3) {
            usage();
        }
        else {
            await DocClient.export(args[1], args[2], args[3]);
        }
    }
    // Import
    else if (cmd === 'import') {
        if (args.length != 4) {
            usage();
        }
        const type = args[3];
        if (type === 'merge') {
            await DocClient.import(args[1], args[2], false);
        } else if (type === 'reset') {
            await DocClient.import(args[1], args[2], true);
        } else {
            usage(`expecting 'merge' or 'reset' but found '${type}`);
        }
    }
    // Schedule backup
    else if (cmd === 'scheduleBackup') {
        verifyBackupSettings();
        console.log("Scheduling backups to run every night at 2 AM");
        nodeCron.schedule("0 0 2 * * *", performBackup);
    }
    // Run Backup Daemon
    else if (cmd === 'runBackupDaemon') {
        verifyBackupSettings();
        await runBackupDaemon();
    }
    // Delete
    else if (cmd === 'delete') {
        if (args.length != 2) {
            usage();
        }
        await DocClient.delete(args[1]);
    }
    // If the arg(s) are not recognize, log them
    else {
        usage(`invalid command: '${cmd}'`);
    }
}

main();
