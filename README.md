[![DFS - Incubating](./_images/discover-incubating.svg)](https://technology.discover.com/technologies/open_source) [![Contributors-Invited](https://img.shields.io/badge/Contributors-Wanted-blue)](./CONTRIBUTE.md)

# dlms-server

Document Lifecycle Management System (DLMS) is a software package that allows you to define collections of documents with given structures, persist the documents to storage, and manage them through a REST API.

## Table of Contents

  - [Features](#features)
  - [Installing](#installing)
  - [Running the Server](#running-the-server)
  - [Server API](#server-api)
  - [DocMgr Initialization](#docmgr-initialization)
  - [Error Types](#error-Types)
  - [Add Endpoints](#add-endpoints)
  - [Add OAuth](#add-oauth)
  - [Implement Profile Service](#implement-profile-service)
  - [Resources](#resources)

## Features

We found a common pattern in many of our applications where we were creating collections of documents that we needed to manage and store, often with role-based access restrictions based on the state of a document.  DLMS is our effort to generalize our code so that it can be used by anyone with similar requirements.

Our code allows you to:
* define user roles
* define collections of documents
    * each collection contains documents of a given type
* define states on each type of document
    * define valid 'next states'
* create user groups
* restrict access based on document state and user group membership or user role
* define actions that can run based on document state
* manage collections, documents and user groups using REST API's

We have found it very useful to be able to define all of the various states that a document can transition through, define the possible order of state changes, enforce that state changes do not occur out of order, and to define who can trigger a state change.  With our ability to run actions as a document changes state, you'll be able to document auditable activity, notify users when a document changes, and much, much more!

## Installing

To install the dlms-server package and its dependencies, run:

```
npm -i dlms-server
```

## Running the server

### Setup the DB
The server requires a noSQL database like MongoDB.  All code in subsequent sections assumes a MongoDB.

In order to install and run the community edition of MongoDB, follow the instructions [here](https://www.mongodb.com/docs/manual/installation/).

As an alternative to installing Mongo, you may prefer to run a Mongo DB using Docker.  More instructions [here](https://hub.docker.com/_/mongo).

When using the DLMS Server, you'll need to define the following environment variables to point to the running instance of your database:
* MONGO_USER: username with which to authenticate to MongoDB
* MONGO_PASS: password with which to authenticate to MongoDB.  Value should be secured.
* MONGO_HOST: URL of database.  Default "127.0.0.1"
* MONGO_PORT: Port at which to access the database.  Default is "27017".

### Setup the Runtime Environment

Other environment variables are available to help configure the experience that you desire on DLMS Server.

| Environment Variable  | Description | Default Value |
| ------------- | ------------- | ------------- |
| IDS_ADMIN  | Comma separated list of userids that will be given the admin role  | |
| EMAIL_ENABLED | Specifies whether server should try to send emails in response to actions on documents or for other reasons |  |
| ADMIN | Basic auth credential for admin if admin id is specified as "admin".  String, in emailAddress:password format. |  |
| DLMS_ADMIN_${uid} | Basic auth credential for admin if admin is specified as ${uid}.  String, in emailAddress:password format. |  |
| API_TOKEN | Specifies a token that will ensure access when used to execute APIs.  Value should certainly be secured. |  |
| HTTP_PROXY / http_proxy | URL of http proxy |  |
| HTTPS_PROXY / https_proxy | URL of https proxy |  |
| USE_PROXY / use_proxy | Comma separated list of domains that require being sent through proxy (e.g. "<external_domain1>, <external_domain2>") |  |
| NO_PROXY / no_proxy | Comma separated list of domains that don't require proxy (e.g. "localhost, 127.0.0.1, <your_enterprise_domain>") |  |
| PORT | The port on which DLMS server will listen | "3000" |
| BASE_URL | The root URL of the running DLMS server | "http://localhost:" + this.port |
| DEBUG | Currently unused | true |
| CORS_ORIGIN | Provides value that will be used for Access-Control-Allow-Origin header in responses from DLMS server | "*" |
| OAUTH_ENABLED | Turns on or off the OAuth middleware usage on the DLMS server | false |
| OAUTH_CLIENT_ID | Public identifier for the OAuth client app |  |
| OAUTH_CLIENT_SECRET | Secret provided to OAuth client app upon registration.  Used to make communications with authorization server more secure |  |
| OAUTH_ISSUER_URL | Domain of the authentication provider |  |
| OAUTH_AUTHORIZATION_URL | The Authorization Server's URL to which authorization requests will be sent | "${OAUTH_ISSUER_URL}/v1/authorize" |
| OAUTH_TOKEN_URL | The Authorization Server's URL to which requests will be make for access tokens  | "${OAUTH_ISSUER_URL}/v1/token" |
| BASIC_AUTH_ENABLED | Turns on or off the basic auth middleware usage on the DLMS server | false |
| SESSION_SECRET | The secret used to sign session data in order to create a JWT | crypto.randomBytes(48).toString("hex") |
| EMAIL_SERVER | URL of SMTP server to use when DLMS needs to send email |  |
| LOG_HTTP_RESPONSE_BODY | if defined, will enable code to log the response body sent in reply to each request made | undefined |
| PASSPORT_DEBUG | if defined, will log information around OIDC authentication | undefined |


## Server API

The DLMS Server serves the React application at the `/` endpoint.

The APIs are under the `/api/` endpoint, with the following apis available:

### /api/action/:type/:id - Invoke the action associated with the document of the given type with the given id.  The action invoked is determined by the document's current state.
- **Method**: POST
- **Body**: any object, arguments to the action function
- **Returns**: any object, undefined if action doesn't exist
- **Return Errors**: 404 document :id was not found, 500
- **Example**: POST /api/action/profiles/evan409 { action:"notifyUser", message:"this is my message"} => {}

### /api/admin/export - Export all application data from DB, Returns all documents from each collection in the DB.  For applications with a large number of documents, exportIds() with exportId() should be used.
User must be an admin to export DB data
- **Method**: GET
- **Returns**: any object
- **Return Errors**: 401 user is not an admin, 500
- **Example**: GET /api/admin/export => { collectionName1:[{...}, {...}, ...], collectionName2:[{...}, {...}, ...]}

### /api/admin/export_ids - Export the ids of all documents from each collection in the DB.  Each document can then be exported using exportId().
User must be an admin to export DB data
- **Method**: GET
- **Returns**: any object
- **Return Errors**: 401 user not an admin, 500
- **Example**: GET /api/admin/export_ids => { collectionName1:[id1, id2, ...], collectionName2:[idA, idB, ...]}

### /api/admin/export/:collection/:id - Export a single document by its id from a specific collection.
User must be an admin to export DB data
- **Method**: GET
- **Returns**: any object
- **Return Errors**: 401 user not an admin, 404 document :id was not found, 500
- **Example**: GET /api/admin/export/:collection/:id => {...}

### /api/admin/import/:collection/:id - Import a single document by its id into a specific collection.
User must be an admin to import DB data
- **Method**: POST
- **Body**: any object.  Document to import.
- **Returns**: any object. Document that was imported.
- **Return Errors**: 400 entry being imported doesn't have _id property, 401 user not an admin, 500, 501 invalid document, 502 document already exists
- **Example**: POST /api/admin/import/:collection/:id => {...}

### /api/admin/import - Import data into collections based on the provided data.  If a document with the given id already exists in the specified collection, that document will be ignored and processing will continue.
User must be an admin to import DB data
- **Method**: POST
- **Body**: any object.  Documents to import.
- **Returns**: void
- **Return Errors**: 400 document has no _id, 401 user not an admin, 500, 501 invalid document, 502 document already exists
- **Example**: POST /api/admin/import { collectionName1:[{...}, {...}, ...], collectionName2:[{...}, {...}, ...]} => void

### /api/admin/reset - Drops all documents from all collections, including user groups.  Will re-initialize user groups specified in the DocMgr constructor before returning.
User must be an admin to reset the DB
- **Method**: GET
- **Query**: simpleInit - optional, boolean.  Default is false.  If specified as true, user groups will not be reconstructed.
- **Returns**: void
- **Return Errors**: 401 user not an admin, 500
- **Example**: GET /api/admin/reset => void

### /api/docs/attachments - Retrieve every attachment in the attachments collection
- **Method**: GET
- **Returns**: `DocList` object
- **Return Errors**: 500
- **Example**: GET /api/docs/attachments => { count: number, items: any[] }

### /api/docs/:collection/:docId/attachments - Retrieve every attachment associated with the given document in the given collection.
User must have read access to this document in its current state in order to retrieve the attachments.
- **Method**: GET
- **Returns**: `DocList` object
- **Return Errors**: 401 user has no read access, 500
- **Example**: GET /api/docs/profiles/evan409/attachments => { count: number, items: any[] }

### /api/docs/:collection/:docId/attachments - Associate a file with the given document in the given collection.
User must have read and write access to this document in its current state.  If no attachment with the same name exists, a new attachment is created.  If the name exists but the file is different, the existing attachment is updated.  If the name exists and the file is the same, no action is taken.
- **Method**: POST
- **Body**: `Express.multer.file`
- **Returns**: array of the AttachmentInfo objects for file
- **Return Errors**: 401 user has no access, 500
- **Example**: POST /api/docs/profiles/evan409/attachments {...} => [ {...}, {...}, ... ]

### /api/docs/:collection/:docId/attachments/:id - Retrieve the given attachment associated with the given document in the given collection.
User must have read access to this document in its current state in order to retrieve the attachment.
- **Method**: GET
- **Returns**: `Readable` object
- **Return Errors**: 401 user has no read access, 404 document :docId or attachment :id was not found, 500
- **Example**: GET /api/docs/profiles/evan409/attachments/070809 => { ... }

### /api/docs/:collection/:docId/attachments/:id - Delete the given attachment associated with the given document in the given collection.
User must have read and write access to this document in its current state in order to delete the attachment.
- **Method**: DELETE
- **Returns**: updated array of the `AttachmentInfo` objects for document
- **Return Errors**: 401 user has no access, 404 document :docId or attachment :id was not found, 500
- **Example**: DELETE /api/docs/profiles/evan409/attachments/070809 => [ {...}, {...}, ... ]

### /api/docs/:type - Create a document in the given collection
User must have access to create documents of the given type.
- **Method**: POST
- **Body**: any object
- **Returns**: The new object retrieved from DB
- **Return Errors**: 401 if documents of the given type are required to have an id and none was provided, 500
- **Example**: POST /api/docs/profiles {...} => {...}

### /api/docs/:type - Retrieve documents of the given type that satisfy the given match
User must have access to read documents of the given type.
- **Method**: GET
- **Query**: match - optional, stringified JSON, specifies selection filter using query operators.
- **Query**: projection - optional, stringified JSON, specifies the fields to return in the documents that match the query filter
- **Returns**: `DocList` object
- **Return Errors**: 401 user has no read access, 500
- **Example**: GET /api/docs/profiles => { count: number, items: any[] }
- **Example**: GET /api/docs/profiles?match= {"$or": [{"_id": "0055"}, {"_id": "0056"}]} => { count: number, items: any[] }

### /api/docs/:type/:id - Retrieve the given document of the given type
User must have read access to this document in its current state in order to retrieve it.
- **Method**: GET
- **Returns**: object retrieved from DB
- **Return Errors**: 401 user has no read access, 404 document :id was not found, 500
- **Example**: GET /api/docs/profiles/evan409 => { ... }

### /api/docs/:type/:id - Create a document of the given type with the given unique id
User must have access to create documents of the given type.
- **Method**: POST
- **Body**: any object
- **Returns**: The new object retrieved from DB
- **Return Errors**: 401 user missing required access, 401 if documents of the given type are required to have an id and none was provided, 500
- **Example**: POST /api/docs/profiles/evan409 { ... } => { "id": "evan409", ... }

### /api/docs/:type/:id - Update a document of the given type with the given unique id
User must have write access to update documents of the given type.  If the update is a state change, user must be authorized to change document to the new state.
- **Method**: PATCH
- **Body**: any object with new property values to change
- **Returns**: The updated object retrieved from DB
- **Return Errors**: 401 user missing required access, 404 document :id was not found, 500 invalid next state
- **Example**: POST /api/docs/profiles/evan409 { "field1": "updated value" } => { "id": "evan409", "field1": "updated value", ... }

### /api/docs/:type/:id - Delete the given document of the given type.
User must have read and write access to this document in its current state in order to delete the document.
- **Method**: DELETE
- **Returns**: Document that was deleted
- **Return Errors**: 401 user missing required access, 404 document :id was not found, 500
- **Example**: DELETE /api/docs/profiles/evan409 => { "id": "evan409", ... }

### /api/user_groups - Retrieve information for all of the user groups
- **Method**: GET
- **Returns**: `UserGroupList` object
- **Return Errors**: 500
- **Example**: GET /api/user_groups => { count: number, items: UserGroupInfo[] }

### /api/user_groups - Create user group
User must be an admin to create a user group.
- **Method**: POST
- **Body**: `UserGroupCreate` object
- **Returns**: the new UserGroupInfo object retrieved from DB
- **Return Errors**: 400 user group with given id already exists, 401 user not an admin, 500
- **Example**: POST /api/user_groups { ... } => { ... }

### /api/user_groups/:id - Retrieve information for given user group
- **Method**: GET
- **Returns**: `UserGroupInfo` object
- **Return Errors**: 404 user group :id was not found, 500
- **Example**: GET /api/user_groups/developers => { "id": "developers", ... }

### /api/user_groups/:id - Update the given user group
User must be an admin to update a user group.
- **Method**: PATCH
- **Body**: `UserGroupUpdate` object
- **Returns**: the updated `UserGroupInfo` object retrieved from DB
- **Return Errors**: 401 user not an admin, 404 user group :id was not found, 500
- **Example**: PATCH /api/user_groups/developers { "members": Person[] } => { "id": "developers", "members": Person[] }

### /api/user_groups/:id - Delete the given user group
User must be an admin to delete a user group.
- **Method**: DELETE
- **Returns**: `UserGroupInfo` object that was deleted
- **Return Errors**: 401 user not an admin, 403 user group is marked undeleteable, 404 document :id was not found, 500
- **Example**: DELETE /api/user_groups/developers => { "id": "developers", ... }

### /health - Request server to respond to liveliness request
Always returns "OK" if it receives the request at all and is able to respond.
- **Method**: GET
- **Returns**: "OK"
- **Return Errors**: none
- **Example**: GET /health => "OK"

## DocMgr Initialization

An application only needs one DocMgr object that it can use throughout the application's lifecycle.  We have found a nice pattern where we extend DocMgr with an application class to allow applications to write simplified interactions with DocMgr that meets its specific needs.  So something like this:

```
export interface DocMgrCreateArgs {
    appName: string;
    documents: Documents;
    userGroups: UserGroupCreate[];
    adminGroups: string[];
    adminRole: string;
    managerRole?: string;
    roles: string[];
    email: string;
    mongoUrl?: string;
    userProfileService?: UserProfileService;
}

export class AppMgr extends DocMgr {

    public static async init(simpleInit?: boolean): Promise<AppMgr> {
        log.debug(`Initializing app manager`);
        const pm = new AppMgr();
        DocMgr.setInstance(pm);
        await pm.init(simpleInit);
        log.debug(`Finished initializing app manager`);
        return pm;
    }

    public static getInstance(): AppMgr {
        return DocMgr.getInstance() as AppMgr;
    }

    constructor() {
        super({
            appName: "MyDocumentApp",
            documents: {
                "AccessRequestDocType": { states: accessRequestStates, docRoles: accessRequestRoles }
                "ProfileDocType": { states: profileDocStates, docRoles: profileRoles, document_id_required: true }
            },
            adminGroups: ["Admin"],
            email: "admin@test.com",
            userGroups: [
                { id: "Admin", deletable: false },
                { id: "Profile", deletable: true },
            ],
            adminRole: "Admin",
            roles: [],
            userProfileService: new MyUserProfileService(),
        });
    }

    public async init(simpleInit?: boolean) {
        await super.init(simpleInit);
    }
}
```

| Property Name | Description |
| ------------- | ----------- |
| appName | The name of your application.  Exported collection names will be prepended with the application name. |
| documents | An object that contains the document types that will be managed by DLMS |
| userGroups | Array of user groups with which to initialize DocMgr |
| adminGroups | Array of user groups whose members will be considered admins |
| adminRole | Specify a role name that will give users admin access |
| roles | Array of role names globally available to users |
| email | The email address that will be used as the default 'from' value in emails sent by DLMS |
| mongoUrl | The URL that will be used by DLMS for establishing database connections.  If not specified, database URL will be determined using the MONGO_* environment values |
| userProfileService | A UserProfileService object that holds the information necessary to allow DLMS to access user records |

### Document Information

The document structures that are most relevant when initializing DLMS are shown here:

```
export interface Document extends DocType {
};
export interface DocType {
    states: {
        [name: string]: DocState;
    };
    collectionName?: string;
    docRoles?: Roles;
    document_id_required?: boolean;
}

export interface Documents {
    [name: string]: DocType;
}
```

A DocMgr instance is initialized with a `Documents` object.
`Documents` contains the `DocType` objects, which represent the various types of documents that the application will manage with DLMS.

For each type of document, the application needs to specify the states that make up the lifecycle of each type using the `DocState` interface.

```
export interface DocState {
    label: string;
    description: string;
    entry?: StateCallback | string[];
    onEntry?: StateActionCallback;
    onReentry?: StateActionCallback;
    read?: StateCallback | string[];
    onRead?: StateActionCallback;
    write?: StateCallback | string[];
    onWrite?: StateActionCallback;
    exit?: StateCallback | string[];
    onExit?: StateActionCallback;
    delete?: StateCallback | string[];
    onDelete?: StateActionCallback;
    action?: StateActionCallback;
    puml?: PumlState;
    nextStates: PossibleStates;
}
```

For each state in the document's lifecycle, the application may use a StateCallback or a string array to define what roles and user groups may be used to transition a document into the given state (i.e. when a state is entered), or transitioned out of a state (i.e. exited) and may read, write or delete a document in the given state.  A `DocState` may also specify what actions may be performed while the document is in this state (StateActionCallback on action property), what actions may happen when the state is entered or a when document in this state is read from or written to (StateActionCallbacks on OnEntry, onRead and onWrite) and what are the possible next states that this document could tranform to.  If a document tries to progress through its states out of order, an error will be thrown.

An example of a DocState might be:

```
approved: {
    label: "Approved",
    description: "The request has been approved.",
    phase: phases.done,
    puml: {
        title: "Approved",
        content: [ 
            "If Reviewer & Button = Approved, then notify Requestor",
            "Requestor can update request",
        ],
        color: "LightGreen",
    },
    entry:async function(ctx) {
        if (await ctx.isCallerInGroup([Roles.Approver, Roles.Administrator])) {
                ctx.notify([ctx.document.owner], ``, `Document request has been approved.`);
        }
        else ctx.accessDeniedError();
        return {groups:[Roles.Employee]}
    },
    write: [Roles.Administrator],
    read: [Roles.Requestor, Roles.Approver, Roles.Administrator],
    nextStates: {
      Closed: {
        groups: [Roles.Approver, Roles.Administrator],
        label: "Close Request",
        description: "Close access request.",
        puml: { title: Approver, label: ["Btn = Close Request"] }
      }
    },
},
```

In this example, a document associated with this DocState has a state called `approved`.  Perhaps this document could be an access request.  The `entry` property in a DocState object is meant to provide access control to those who are allowed to put this type of document into the `approved` state.  `entry`, and properties like it such as `write` or `read`, may return either an array of role names or a function that will return user groups.  DocMgr will determine if the user attributed to this state change has one of the specified roles or is in one of the user groups allowed to approve this type of document.  It does this by checking the email address of the user against the list of email addresses in the user groups.  If the user doesn't belong to an approved group or have one of the approved roles, a 401 Access Denied error will likely be returned.  If the user affecting the document does have the required access, the document will successfully enter the `approved` state.

#### PUML

You may notice above that the document state has a property called `puml`.  If you define a `puml` property in each of your states like the one above, you'll be able to create a state diagram that visually connects your document states in an easy to read diagram.  This type of diagram is very useful to commit into your application's documentation to help people visualize how a document progresses through its states.  To see an example of how this might work, checkout the script in [DLMS Sample repository](https://github.com/discoverfinancial/dlms-sample/code/src/puml.ts).  This script is executed when the user runs `npm run puml` on the DLMS Sample code.


### User Information

When a DocMgr is constructed, a `UserProfileService` can be specified.  This can be any type of service that manages users as long as it can be wrapped by the `UserProfileService` interface.  You can find more information [here](#implement-profile-service).  For this section, the important thing to know is that the `UserProfileService` returns a `UserContext` object.  The most important interfaces related to Users are here:

```
export interface UserContext {
    user: User;
    docId?: string;
    updates?: any;
    mode?: "create" | "read" | "update" | "delete";
    isAdmin?: boolean;
    [key: string]: any;
}
export interface Person {
    name: string;
    department: string;
    email: string;
    title: string;
    employeeNumber: string;
    [key: string]: any;
}
export interface PersonWithId extends Person {
    id: string;
}
export interface User extends Person {
    id: string;
    roles: string[];
}
```

After a user's authentication is verified with the user profile service, the resulting UserContext object is made available to DocMgr by DLMS as it stores the UserContext on the request object during authentication and it is passed thru to almost all DocMgr methods.  One of the key properites that a User has, particularly as it relates to document management, is their collection of roles.

### Document Access

There are a variety of ways that a user can acquire access to a document in DLMS:
* A user may be given a set of roles during authentication.  For example, it is common to find the `Employee` role on a `Person` returned from LDAP.  As seen above, there is a `roles` property on all Users that is a string[] containing role names.
* A user group may be defined, and a user may be added to the group, by an Administrator.  An application may choose to provide a user interface for its administrators that includes the ability to add users and create user groups.  DLMS exposes [REST APIs](#server-api) related to User Group managment that can be used to create and manage User Groups.
* A document may contain a field/property with the name of the role.  For example, you could define a property `approvers` with the datatype `Person[]` on the interface that you use to create a document in your application.  Please note that the datatype `Person` already exists in DLMS. Also, note that if you want only one approver associated with a Request document, you would use the datatype `Person` in place of `Person[]`.
* When specifying the `DocMgrCreateArgs` object used to initialize the `AppMgr` instance in the example above, it is possible to provide a `Roles` object in the `docRoles` property of a document type.  In the `Roles` object you can provide, for each role, a `getMembers` function that will allow you to dynamically determine the members of that Role/user group.  As an example, a `Roles` object may look like this:

```
export const Roles = {
    Administrator: "Admin",
    Requestor: "requestors",
    Approver: {
        name: "Approver",
        getMembers: async function(ctx: StateCallbackContext) {
            return ctx.document.reviewers;
        },
    },
    Sponsor: "sponsors",
    Employee: "Employee",
}
```
In the example of the **approved** `DocState` above, you'll notice that users in the group Roles.Approver are able to transition the document into the **approved** state.  You'll see from this example of Roles that DLMS will determine if a user is an Approver for this document by testing to see if their email is in ctx.document.reviewers.

To expand on this thought, it is often appropriate that only the document owner and admins may affect a document.  In a scenario like this, you could create an Owner role on a Roles object like this:

```
Owner: {
        name: "Owner",
        getMembers: async function(ctx: StateCallbackContext) {
            return [ctx.document.owner];
        },
    }
```

## Error Types

The main Error type that is thrown by the DLMS Server APIs is `DocError`.  This error contains a scode property that houses the appropriate http error code for the given error.

```
export class DocError extends Error {

    public readonly scode: number;

    constructor(scode: number, msg: string) {
        super(msg);
        this.scode = scode;
    }

}

export function throwErr(scode: number, msg: string): never {
    throw new DocError(scode, msg);
}
```

Standard JavaScript Errors are thrown for authentication failures and server misconfiguration issues.

## Add Endpoints

The endpoints for DLMS Server live in controller files that live in the `server/src/controllers` directory.  This is configured by the `server/tsoa.json` file in the **controllerPathGlobs** property:

```
{
  "entryFile": "src/index.ts",
  "noImplicitAdditionalProperties": "throw-on-extras",
  "controllerPathGlobs": ["src/controllers/*.ts"],
  "spec": {
    "outputDirectory": "build",
    "specVersion": 3
  },
  "routes": {
    "routesDir": "src"
  }
}
```

The tsoa package will use the decorators found in the controller files to build the file `/server/src/routes.ts` which governs the execution of API logic.  Currently there are 5 controllers:

| Controller | Endpoint | Description |
| ---------- | -------- | ----------- |
| actionController | /api/action | triggers a state action to be executed on the server |
| adminController | /api/admin | actions on user data that may be executed by admins |
| attachmentGroupController | /api/docs | manages the attachments that may exist on documents |
| docController | /api/docs/{type} | manages documents |
| userGroupController | /api/user_groups | manages User Groups |

If you wish to add an endpoint to DLMS, you should consider if your endpoint fits into one of the controllers that already exists.  Otherwise you can add a new controller file into `server/src/controllers` and follow the pattern of decorators similar to the other controllers and extending the DocMgr object if necessary.

If you find the APIs or functionality of DLMS lacking, please consider working with our maintainers and contributing your changes back to the DLMS code repository!

## Add OAuth

To prepare your DLMS-based server to use OAuth, please review the environment variables available to you as mentioned [above](#setup-the-runtime-environment).  You will need to:

* Enable OAuth
  * OAUTH_ENABLED=true

* Tell DLMS about your OAuth provider.  These are required in order to have a properly configured OAuth environment in DLMS.
  * OAUTH_ISSUER_URL=<URL to your OAuth resource server>
  * OAUTH_CLIENT_ID=<your web application OAuth client id>
  * OAUTH_CLIENT_SECRET=<your web application OAuth client secret>
    * ensure that your secret is properly stored and kept secure

* Optionally, you can provide more information about your OAuth provider and your web application.  DLMS has defaults for these environment variables, but they may not work for your unique situation.
  * OAUTH_AUTHORIZATION_URL=<Authorization URL supplied by your OAuth provider>
    * default: $OAUTH_ISSUER_URL/v1/authorize
  * OAUTH_TOKEN_URL=<Token URL supplied by your OAuth provider>
    * default: $OAUTH_ISSUER_URL/v1/token

**Note:** There are a few hard-coded OAuth values in DLMS:
  * The OAuth callback URL used by the DLMS OAuth implementation is set to $BASE_URL/oauth/authorization
  * The OAuth user info URL is set to $OAUTH_AUTHORIZATION_URL/v1/userinfo

To view the code for the OAuth implementation, please see `server/src/authOidc.ts`


## Implement Profile Service

DLMS makes use of, and expects to be provided with, a user profile service in all instances where authentication is enabled for the web application using DLMS.  When basic auth is enabled, the user's userid and password are passed to the profile service for verification.  If verified, a `UserContext` is returned.  When OAuth is enabled, user information is returned by the OAuth service provider when the user authenticates with the provider and grants the web application limited rights to their data.  An identifier from this user information, like a userid or email address, will be passed to the profile service in order to retrieve a `UserContext` for the user.

In both cases, the fact that the user profile service found a `UserContext` for the provided user identifier is proof that the user is known to the application.  So how does a web application associate a user profile service with DLMS?

When a web application creates its instance of DocMgr, it may pass a user profile service to the constructor.  The service must implement the `UserProfileService` interface:

```
import { UserContext } from "dlms-base";
export interface UserProfileService {
    get(claimsOrUid: any): Promise<UserContext[]>;
    verify(uid: string, pwd: string): Promise<UserContext>;
}
```

As an example, let us assume that you make use of an LDAP server to manage your user authentication data.  You will need to write a wrapper to that LDAP server that implements the `UserProfileService` interface and pass an instance to that class to the DocMgr constructor.  This class that you create will need to be able to construct the correct LDAP query using the user's identifier to retrieve the user's information.  The class will also need to be able to transform the retrieved information into a `UserContext` object and return it to the caller.

A very simplified user profile service can be found in the DLMS Sample.  A link to the DLMS Sample repository can be found in the [resources](#resources).

## Resources

* [DLMS Sample](https://github.com/discoverfinancial/dlms-sample)
  * Sample web application that is built using DLMS technology
* [DLMS Architecture](./ARCHITECTURE.md)
* [State diagrams in PlantUML](https://plantuml.com/state-diagram)

## License

[MIT](#license)
