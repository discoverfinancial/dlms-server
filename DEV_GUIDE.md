# DLMS Server Developer Guide

This document serves as a getting started guide for working with the DLMS Server.

- [Install Dependencies](#install-dependencies) 
- [Install and Use](#install-and-use)
- [Development](#development)
- [Understanding Server APIs](#understanding-server-apis)
- [Creating Epics](#creating-epics)

## Install Dependencies
The DLMS Server can be built and run locally using a Javascript Runtime Environment.

### Basic Requirements

* Install [git](https://github.com/git-guides/install-git)
* Learn how to [fork](https://docs.github.com/en/get-started/quickstart/fork-a-repo) and [clone](https://github.com/git-guides/git-clone) GitHub repositories.

If you desire to extend or enhance the Base or Server code, a local development environment will need to be configured. This requires the installation of Node.js prerequisites, specifically NodeJS 18+ and npm 8+. Visit [nodejs downloads](https://nodejs.org/en/download/) for latest versions.

## Install and Use
Perform the following steps to run a local version of the application.

### Fetch Latest Code
These instructions assume you have a local copy of a forked instance of [discoverfinancial/dlms-server](https://github.com/discoverfinancial/dlms-server).

```
cd <WORKSPACE>
git clone https://github.com/<YOUR-ORG>/dlms-server
cd dlms-server
```

where:

* `<WORKSPACE>` is path to the local folder where you have created a copy of the GitHub repository.
* `<YOUR-ORG>` is the name of your GitHub account or personal GitHub organization.

### Build, Test and Run the Server
The following commands will build and run the server using a local Node.js environment running on a Linux distribution such as MacOS. Running the tests or the server requires that a version of MongoDB is running.  By default, the server will try to connect to the DB at localhost:27017.

```
cd dlms-server/server

# build the base code and copy it where the server can access it
./reimport

# build the server code
npm run build

# run the unit testcases
npm run test

# run the server with default authentication
npm run server
```

You'll know that the server started successfully if you see output similar to:

```
05/29/2024 11:35:16.881 INFO proxy Initializing proxy
05/29/2024 11:35:16.882 INFO app OAuth authentication is disabled
05/29/2024 11:35:16.884 INFO app Listening on port 3000
```

## Understanding Server APIs

Documentation for the server APIs may be found [in the README](./README.md#server-api) or on a running DLMS Server using the `/api/swagger` endpoint.

