
## Backup (Document Client)

The document client supports backing up, exporting and importing documents from a DLMS Server.

Once set up, the backup action (based on export) will run as a daemon every day at 2am.  At any point, a backup can be restored (import).

This functionality is essential for disaster recovery, but can also be used to bring data over to development environments.

### Building

```
cd backup/code
npm run build
```

### Exporting

To perform a backup supply the following two environment variables:
```
# URL of the running DLMS-based web application
export URL=https://dlms-app......
# Directory to store the export
export BACKUP_DIR=/tmp/appname/export/dev1
```

You may also need to supply an admin-level username and password for the targeted DLMS Server:
```
export USER=admin
export PASS=..............
```

The backup daemon, by default, runs once a day.  You may modify that behavior using:
```
# in milliseconds, specifies how long between server backups
export BACKUP_DELAY=...
```

Then, from the `backup/code` directory simply run the command:
```
npm run backup
```
If you want to take a single snapshot, you could run `npm run export` instead.


### Importing

To restore from a backup, supply the following two environment variables:
```
# URL of the app running where the data should be imported to
export URL=https://dlms-app......
# Directory containing the exported data that will be imported
export FROM_DIR=/tmp/appname/export/dev1
```

You may also need to supply an admin-level username and password for the targeted DLMS Server:
```
export USER=admin
export PASS=..............
```

Then, from the `backup/code` directory simply run the command:
```
# Allows user to import information into the DLMS DB after clearing the DLMS DB
npm run import-reset
```

If you'd like to import data without resetting the DB, run:
```
# Import data into collections based on the provided data.
# If a document with a given id is being imported into a given
#  collection but a document with that id already exists in the DB,
#  that document will be ignored and processing will continue.
npm run import
```

### How it Works

Each backup creates a directory named after the current date and time. The hashes of each document are stored in this directory.

In addition, there is a common `files` directory which contains all the documents and their contents, named after their hash.

