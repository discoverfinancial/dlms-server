/**
 * Copyright (c) 2024 Discover Financial Services
 */
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import { CollectionInfo, ObjectId } from 'mongodb';
import { Logger } from './logger';
import { Config } from './config';
import { getField, throwErr } from './util';
import {
    DefaultUserProfileService,
    UserProfileService,
} from './userProfileService';
import {
    UserContext,
    UserGroupInfo,
    UserGroupCreate,
    UserGroupUpdate,
    UserGroupList,
    DocState,
    Person,
    PersonWithId,
    StateCallback,
    StateCallbackContext,
    DocInfo,
    Roles,
    EmailAttachment,
} from 'dlms-base';
export * from 'dlms-base';

const log = new Logger('dlms-docMgr');

const adminIds: string[] = process.env.IDS_ADMIN
    ? process.env.IDS_ADMIN.split(',')
    : [];

const emailEnabled = process.env.EMAIL_ENABLED === 'true';
export interface Metadata {
    version: number;
    last: boolean;
}
export interface AttachmentModelCreate {
    collection: string;
    doc: string;
    hash: string;
    name: string;
    size: number;
    date: number;
    type: string;
    data: Buffer;
}

export interface AttachmentModel extends AttachmentModelCreate {
    _id: string;
}

export interface Document extends DocType {}
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

export interface DocSpec {
    type: string;
    id: string;
    version?: string;
}

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

interface UserGroupCacheEntry {
    [id: string]: UserGroupInfo;
}

export class DocMgr {
    private static instance: DocMgr | undefined;

    /**
     * Sets the instance of DocMgr if it has not been set already.
     *
     * @param {DocMgr} instance - The instance of DocMgr to set
     * @returns {void}
     */
    public static setInstance(instance: DocMgr) {
        if (DocMgr.instance) {
            return throwErr(500, `DocMgr.setInstance has already been called`);
        }
        DocMgr.instance = instance;
        mongoose.set('strictQuery', true);
    }

    /**
     * Get the instance of DocMgr.
     *
     * @returns {DocMgr} The instance of DocMgr
     */
    public static getInstance(): DocMgr {
        if (!DocMgr.instance) {
            return throwErr(500, `DocMgr.setInstance has not been called`);
        }
        return DocMgr.instance;
    }

    private appName: string;
    private documents: Documents;
    private email: string;
    private mongoUrl: string;
    private userCollectionName: string;
    private attachmentCollectionName: string;
    private allCollectionNames: string[];
    private transporter: nodemailer.Transporter;
    private adminCtx: UserContext;
    private userGroups: UserGroupCreate[];
    private adminGroups: string[];
    private adminRole: string;
    private managerRole: string;
    private roles: string[];
    private userGroupCache: UserGroupCacheEntry;
    private connected = false;
    private initialized = false;
    private simpleInit: boolean | undefined;
    private userProfileService: UserProfileService;

    /**
     * Constructor for creating a new DocMgr instance.
     *
     * @param {DocMgrCreateArgs} args - The arguments needed to initialize the DocMgr.
     */
    constructor(args: DocMgrCreateArgs) {
        this.appName = args.appName;
        this.documents = args.documents;
        this.email = args.email;
        this.mongoUrl = args.mongoUrl || this.getMongoUrl();
        this.userCollectionName = `${this.appName}.user`;
        this.attachmentCollectionName = `${this.appName}.attachment`;
        const cNames = [this.userCollectionName, this.attachmentCollectionName];
        this.allCollectionNames = cNames.concat(
            Object.keys(args.documents).map(key =>
                this.getDocCollectionName(key)
            )
        );
        const config = new Config();
        this.transporter = nodemailer.createTransport({
            host: config.emailServer,
            port: 25,
            tls: { rejectUnauthorized: false },
        });
        this.adminCtx = {
            user: {
                id: 'docMgr',
                name: 'DocMgr',
                roles: ['Admin'],
                email: 'DLMSServer',
                title: 'Admin',
                employeeNumber: 'none',
                department: 'none',
            },
        };
        this.userGroups = args.userGroups;
        this.adminGroups = args.adminGroups;
        this.adminRole = args.adminRole;
        this.managerRole = args.managerRole || '';
        this.roles = args.roles;
        this.userGroupCache = {};
        this.userProfileService =
            args.userProfileService || new DefaultUserProfileService();
        //? DocMgr.instance = this;
    }

    /**
     * Returns the UserProfileService associated with this instance.
     *
     * @returns {UserProfileService} The UserProfileService instance
     */
    public getUserProfileService(): UserProfileService {
        return this.userProfileService;
    }

    /**
     * Returns the admin role associated with this instance.
     *
     * @returns {string} The admin role
     */
    public getAdminRole(): string {
        return this.adminRole;
    }

    /**
     * Gets the manager role.
     *
     * @returns {string} The manager role.
     */
    public getMgrRole(): string {
        return this.managerRole;
    }

    /* allow unused ctx parameter, used by extending classes */
    /* eslint-disable @typescript-eslint/no-unused-vars */
    /**
     * Get global roles for user when they log in.  This is only called at authentication time.
     *
     * @param ctx The user context
     * @returns string array of user roles
     */
    public async getRoles(ctx: UserContext): Promise<string[]> {
        return this.roles;
    }
    /* eslint-enable @typescript-eslint/no-unused-vars */

    /**
     * Get document roles.  This is used for checking for read, write, entry, etc. access.
     *
     * @param ctx The user context
     * @returns array of document roles
     */
    public async getDocRoles(ctx: UserContext, type?: string): Promise<Roles> {
        if (type) {
            return this.documents[type]?.docRoles || {};
        }
        return {};
    }

    private initHasBeenCalled = false;

    /**
     * Initializes the system if not already initialized.
     * Sets up initial configuration and user groups.
     *
     * @param {boolean} simpleInit - Optional flag to perform a simple initialization.
     */
    public async init(simpleInit?: boolean) {
        if (this.initialized) {
            return;
        } else if (!this.initHasBeenCalled) {
            this.simpleInit = simpleInit;
            this.initHasBeenCalled = true;
        }
        try {
            const ctx = this.adminCtx;
            if (!this.simpleInit) {
                for (const ug of this.userGroups) {
                    await this.getOrCreateUserGroup(ctx, {
                        id: ug.id,
                        deletable: ug.deletable,
                    });
                }
            }
            this.initialized = true;
        } catch (e: any) {
            log.err(`Failed to initialize database: ${e.message}`);
        }
    }

    /**
     * Create a new document and let mongo assign a unique ID.
     *
     * @param {UserContext} ctx - The user context.
     * @param {string} type - The type of the document.
     * @param {any} doc - The document to create.
     * @returns {Promise<any>} The created document.
     */
    public async createDoc(
        ctx: UserContext,
        type: string,
        doc: any
    ): Promise<any> {
        const dt = this.getDocType(type);
        if (dt.document_id_required) {
            return throwErr(
                401,
                `documents of type '${type}' require the ID to be specified by the caller`
            );
        }
        delete doc._id;
        delete doc.id;
        return await this._createDoc(ctx, type, doc);
    }

    /**
     * Create a new document with the specified ID.
     *
     * @param {UserContext} ctx - The user context.
     * @param {string} type - The type of the document.
     * @param {string} id - The ID of the document.
     * @param {any} doc - The document to create.
     * @returns {Promise<any>} The created document.
     */
    public async createDocById(
        ctx: UserContext,
        type: string,
        id: string,
        doc: any
    ): Promise<any> {
        const dt = this.getDocType(type);
        if (!dt.document_id_required) {
            return throwErr(
                401,
                `documents of type '${type}' may not be created with an ID that is specified by the caller`
            );
        }
        doc._id = id;
        return await this._createDoc(ctx, type, doc);
    }

    /**
     * Create a new document with the specified ID.
     *
     * @param {UserContext} ctx - The user context.
     * @param {string} type - The type of the document.
     * @param {any} doc - The document to create.
     * @returns {Promise<any>} The created document.
     */
    protected async _createDoc(
        ctx: UserContext,
        type: string,
        doc: any
    ): Promise<any> {
        log.debug(`Creating document of type ${type}`);
        ctx.mode = 'create';
        await this.assertEntryAccess(ctx, type, doc);
        const docState = await this.getDocState(ctx, type, doc.state);
        if (docState.onEntry) {
            await docState.onEntry(
                new StateCallbackContextImpl(
                    ctx,
                    this,
                    type,
                    this.toInfo(doc, true)
                )
            );
        }

        // Cache read, write in document for current state
        doc.curStateRead =
            (await this.getInUserGroups(ctx, docState.read, type, doc)) || [];
        doc.curStateWrite =
            (await this.getInUserGroups(ctx, docState.write, type, doc)) || [];

        const pc = await this.getDocCollection(type);
        const result = await pc.insertOne(doc);
        const id = result.insertedId.toString();
        log.debug(
            `Created document of type ${type} with id ${id}, getting doc`
        );
        const rtn = await this._getDoc(ctx, { type, id });
        log.debug(`Got doc of type ${type} with id ${id}`);
        return rtn;
    }

    // Get the value of a document by it's unique 'id'.
    // If a 'version' is specified, return that version of the document;
    // otherwise, return the latest version of the document.

    /**
     * Retrieves a document based on the provided 'ds' (DocSpec) with optional projection.
     *
     * @param {UserContext} ctx - The user context.
     * @param {DocSpec} ds - The document specification.
     * @param {any} projection - Optional projection for the document.
     * @returns {Promise<any>} The retrieved document.
     */
    public async getDoc(
        ctx: UserContext,
        ds: DocSpec,
        projection?: any
    ): Promise<any> {
        ctx.docId = ds.id;
        ctx.mode = 'read';
        const doc = await this._getDoc(ctx, ds);
        await this.assertReadAccess(ctx, ds.type, doc);
        const docState = await this.getDocState(ctx, ds.type, doc.state);
        if (docState.onRead) {
            await docState.onRead(
                new StateCallbackContextImpl(
                    ctx,
                    this,
                    ds.type,
                    this.toInfo(doc, true)
                )
            );
        }
        if (!projection) {
            return doc;
        }
        const r = await this._getDoc(ctx, ds, projection);
        return r;
    }

    /**
     * Run the action for the document's current state and return it's result.
     *
     * @param ctx The user context
     * @param ds The document type and id
     * @param args Any data needed by the action
     *
     * @returns Any data
     */
    public async runActionForDoc(
        ctx: UserContext,
        ds: DocSpec,
        args: any
    ): Promise<any> {
        if (ds.id == 'none') {
            const doc = this.getDocType(ds.type);
            const stateNames = Object.keys(doc.states);
            const docState = doc.states[stateNames[0]];
            ctx.updates = args;
            if (docState.action) {
                return await docState.action(
                    new StateCallbackContextImpl(ctx, this, ds.type, {})
                );
            }
        } else {
            const doc = await this.getDoc(ctx, ds);
            const docState = await this.getDocState(ctx, ds.type, doc.state);
            if (docState.action) {
                ctx.updates = args;
                return await docState.action(
                    new StateCallbackContextImpl(
                        ctx,
                        this,
                        ds.type,
                        this.toInfo(doc, true)
                    )
                );
            }
        }
    }

    /**
     * Retrieves a document based on the provided 'ds' (DocSpec) with optional projection.
     *
     * @param {UserContext} ctx - The user context.
     * @param {DocSpec} ds - The document specification.
     * @param {any} projection - Optional projection for the document.
     * @returns {Promise<any>} The retrieved document.
     */
    protected async _getDoc(
        ctx: UserContext,
        ds: DocSpec,
        project?: any
    ): Promise<any> {
        const filter = this.docFilter(ds);
        log.debug(`Getting doc: ${JSON.stringify(ds)}`);
        const pc = await this.getDocCollection(ds.type);
        const doc: any = await pc.findOne(filter, { projection: project });
        if (!doc) {
            return throwErr(
                404,
                `document '${JSON.stringify(ds)}' was not found`
            );
        }
        return this.toInfo(doc, false);
    }

    /**
     * Retrieves the document type based on the provided type.
     *
     * @param {string} type - The type of the document.
     * @returns {DocType} The document type object.
     */
    public getDocType(type: string): DocType {
        if (!(type in this.documents)) {
            return throwErr(400, `Invalid document type: '${type}'`);
        }
        return this.documents[type];
    }

    /**
     * Retrieves the DocState object of a document based on the provided type and state.
     *
     * @param {UserContext} ctx - The user context.
     * @param {string} type - The type of the document.
     * @param {string} state - Optional state of the document.
     * @returns {Promise<DocState>} The document state.
     */
    public async getDocState(
        ctx: UserContext,
        type: string,
        state?: string
    ): Promise<DocState> {
        const doc = this.getDocType(type);
        if (state !== undefined) {
            state = state.split('$')[0];
            if (!(state in doc.states)) {
                const admin = await this.isAdmin(ctx);
                // Allow to continue so admin can delete bad documents
                if (admin) {
                    log.err(
                        `Invalid state in '${type}' document: '${state}' - allow to continue since user is admin`
                    );
                    return {
                        label: 'invalid',
                        description: '',
                        nextStates: {},
                    };
                }
                return throwErr(
                    400,
                    `Invalid state in '${type}' document: '${state}'`
                );
            }
            return doc.states[state];
        } else {
            // The 'state' parameter comes from the document.
            // Allow a document without a state only if the document type has only one state, which means we
            // can always safely return that one doc state.
            const stateNames = Object.keys(doc.states);
            if (stateNames.length !== 1) {
                return throwErr(
                    400,
                    `Document of type '${type}' can have multiple states but it is missing a 'state' field`
                );
            }
            return doc.states[stateNames[0]];
        }
    }

    // Get the latest version of one or more documents.
    // Specify or more documents.

    /**
     * Retrieves documents based on the specified criteria.
     *
     * @param {UserContext} ctx - The user context.
     * @param {string} type - The type of document.
     * @param {any} match - The matching criteria for document retrieval.
     * @param {any} projection - The projection criteria for document retrieval.
     * @returns {Promise<any[]>} An array of retrieved documents.
     */
    public async getDocs(
        ctx: UserContext,
        type: string,
        match?: any,
        projection?: any
    ): Promise<any[]> {
        const pc = await this.getDocCollection(type);
        // const filters: Object[] = groups.map(g => {
        //     return this.createMyUserMatchFilter(ctx,g);
        // });
        //const match = //{"$or": filters};
        //const admin = await this.isAdmin(ctx);
        log.debug(
            `Searching ${type} with match filter of ${JSON.stringify(match)} and projection of ${JSON.stringify(projection)}`
        );

        // Must convert any _id to ObjectId
        let _match: any = {};
        if (typeof match === 'string') {
            _match = JSON.parse(match);
        } else if (match) {
            _match = match;
        }
        try {
            if (_match['$or']) {
                const matchOr = _match['$or'];
                for (let i = 0; i < matchOr.length; i++) {
                    if (matchOr[i]._id) {
                        matchOr[i]._id = new ObjectId(matchOr[i]._id);
                    }
                }
                _match['$or'] = matchOr;
            }
        } catch (e) {
            log.debug('Error processing match[$or]:', e);
        }
        let _projection: any = {};
        if (typeof projection === 'string') {
            _projection = JSON.parse(projection);
        } else {
            _projection = projection;
        }
        const docs = await pc
            .find(_match, { projection: _projection })
            .toArray();
        log.debug(
            `Searched for match with ${JSON.stringify(_match)} and found ${docs.length} documents`
        );
        const rtn: any = [];
        for (let doc of docs) {
            doc = this.toInfo(doc, false);
            ctx.docId = doc.id;
            ctx.mode = 'read';
            try {
                if (await this.hasReadAccess(ctx, type, doc)) {
                    rtn.push(doc);
                    const docState = await this.getDocState(
                        ctx,
                        type,
                        doc.state
                    );
                    if (docState.onRead) {
                        await docState.onRead(
                            new StateCallbackContextImpl(
                                ctx,
                                this,
                                type,
                                this.toInfo(doc, true)
                            )
                        );
                    }
                }
            } catch (e) {
                log.debug('Error getting doc: ', e);
            }
        }
        return rtn;
    }

    /**
     * Assert that the current user can enter state
     *
     * @param ctx The user context
     * @param type The document type
     * @param doc The document
     *
     * @throws 401 if user cannot enter state
     */
    protected async assertEntryAccess(
        ctx: UserContext,
        type: string,
        doc: any
    ) {
        if (!(await this.hasEntryAccess(ctx, type, doc))) {
            throwErr(401, 'entry access denied');
        }
    }

    /**
     * Assert that the current user can read document in current state
     *
     * @param ctx The user context
     * @param type The document type
     * @param doc The document
     *
     * @throws 401 if user cannot read document
     */
    protected async assertReadAccess(ctx: UserContext, type: string, doc: any) {
        if (!(await this.hasReadAccess(ctx, type, doc))) {
            throwErr(401, 'read access denied');
        }
    }

    /**
     * Assert that the current user can write document in current state
     *
     * @param ctx The user context
     * @param type The document type
     * @param doc The document
     *
     * @throws 401 if user cannot write document
     */
    protected async assertWriteAccess(
        ctx: UserContext,
        type: string,
        doc: any
    ) {
        if (!(await this.hasWriteAccess(ctx, type, doc))) {
            throwErr(401, 'write access denied');
        }
    }

    /**
     * Assert that the current user can delete document in current state
     *
     * @param ctx The user context
     * @param type The document type
     * @param doc The document
     *
     * @throws 401 if user cannot write document
     */
    protected async assertDeleteAccess(
        ctx: UserContext,
        type: string,
        doc: any
    ) {
        if (!(await this.hasDeleteAccess(ctx, type, doc))) {
            throwErr(401, 'delete access denied');
        }
    }

    /**
     * Determine if the current user can enter state
     *
     * @param ctx The user context
     * @param type The document type
     * @param doc The document
     *
     * @returns true if user can enter state, false if not
     */
    protected async hasEntryAccess(
        ctx: UserContext,
        type: string,
        doc: any
    ): Promise<boolean> {
        const docState = await this.getDocState(ctx, type, doc.state);
        try {
            await this.assertInUserGroups(ctx, docState.entry, type, doc);
        } catch (e) {
            return false;
        }
        return true;
    }

    /**
     * Determine if the current user can read document in current state
     *
     * @param ctx The user context
     * @param type The document type
     * @param doc The document
     *
     * @returns true if user can read document, false if not
     */
    protected async hasReadAccess(
        ctx: UserContext,
        type: string,
        doc: any
    ): Promise<boolean> {
        const docState = await this.getDocState(ctx, type, doc.state);
        log.debug(
            `Checking to see if ${ctx.user.email} has read access to a ${type} document ${doc.id}; state=${doc.state}`
        );
        // const admin = await this.isAdmin(ctx);
        // if (admin) {
        //     log.debug(`Read access granted for ${ctx.user.email} to ${type} document ${doc.id} because user is admin`);
        //     return true;
        // }
        try {
            await this.assertInUserGroups(ctx, docState.read, type, doc);
        } catch (e) {
            log.debug(
                `Read access denied for ${ctx.user.email} to ${type} document ${doc.id}`
            );
            return false;
        }
        log.debug(
            `Read access granted for ${ctx.user.email} to ${type} document ${doc.id}`
        );
        return true;
    }

    /**
     * Determine if the current user can write document in current state
     *
     * @param ctx The user context
     * @param type The document type
     * @param doc The document
     *
     * @returns true if user can write document, false if not
     */
    protected async hasWriteAccess(
        ctx: UserContext,
        type: string,
        doc: any
    ): Promise<boolean> {
        const docState = await this.getDocState(ctx, type, doc.state);
        log.debug(
            `Checking to see if ${ctx.user.email} has write access to a ${type} document ${doc.id}; state=${doc.state}`
        );
        // const admin = await this.isAdmin(ctx);
        // if (admin) {
        //     log.debug(`Write access granted for ${ctx.user.email} to ${type} document ${doc.id} because user is admin`);
        //     return true;
        // }
        try {
            await this.assertInUserGroups(ctx, docState.write, type, doc);
        } catch (e) {
            log.debug(
                `Write access denied for ${ctx.user.email} to ${type} document ${doc.id}`
            );
            return false;
        }
        log.debug(
            `Write access granted for ${ctx.user.email} to ${type} document ${doc.id}`
        );
        return true;
    }

    /**
     * Determine if the current user can delete document in current state
     *
     * @param ctx The user context
     * @param type The document type
     * @param doc The document
     *
     * @returns true if user can delete document, false if not
     */
    protected async hasDeleteAccess(
        ctx: UserContext,
        type: string,
        doc: any
    ): Promise<boolean> {
        const docState = await this.getDocState(ctx, type, doc.state);
        log.debug(
            `Checking to see if ${ctx.user.email} has delete access to a ${type} document ${doc.id}; state=${doc.state}`
        );
        // const admin = await this.isAdmin(ctx);
        // if (admin) {
        //     log.debug(`Delete access granted for ${ctx.user.email} to ${type} document ${doc.id} because user is admin`);
        //     return true;
        // }
        try {
            await this.assertInUserGroups(ctx, docState.delete, type, doc);
        } catch (e) {
            log.debug(
                `Delete access denied for ${ctx.user.email} to ${type} document ${doc.id}`
            );
            return false;
        }
        log.debug(
            `Delete access granted for ${ctx.user.email} to ${type} document ${doc.id}`
        );
        return true;
    }

    /**
     * Allow the class that extends DocMgr to update the args.
     *
     * @param {UserContext} ctx - The user context
     * @param {DocSpec} ds - The document type and id
     * @param {any} args - Any data
     * @returns {Promise<any>} Promise that resolves to any data
     */
    public async updateArgs(
        ctx: UserContext,
        ds: DocSpec,
        args: any
    ): Promise<any> {
        return args;
    }

    /**
     * Update a document.
     *
     * @param {UserContext} ctx - The user context
     * @param {DocSpec} ds - The document type and id
     * @param {any} args - Any data to update the document
     * @returns {Promise<any>} Promise that resolves to the updated document
     */
    public async updateDoc(
        ctx: UserContext,
        ds: DocSpec,
        args: any
    ): Promise<any> {
        const caller = ctx.user.email;
        log.debug(
            `'${caller}' is updating doc '${ds.type}/${ds.id}': ${JSON.stringify(args)}`
        );
        ctx.docId = ds.id;
        const type = ds.type;
        ctx.mode = 'update';
        ctx.updates = args;
        // Get the current version of the doc
        const doc = await this._getDoc(ctx, ds);
        // Get the doc state object associated with the current state of the doc
        const docState = await this.getDocState(ctx, ds.type, doc.state);
        const hasNonStateChange = this.hasNonStateKey(args);
        const admin = await this.isAdmin(ctx);
        // If the doc state is passed in
        const newState = args.state;
        if (newState) {
            // Make sure caller is authorized to change to this new state
            log.debug(
                `Checking permission for '${caller}' to move from state '${doc.state}' to '${newState}'`
            );
            // if (admin) {
            //     log.debug(`Write granted for ${caller} because user is admin`);
            // }
            if (docState.nextStates[args.state]) {
                await this.assertInUserGroups(
                    ctx,
                    docState.nextStates[args.state].groups,
                    type,
                    doc
                );
            } else {
                log.debug(
                    `Moving from state '${doc.state}' to '${newState}' is not valid.`
                );
                if (!admin) {
                    throwErr(500, 'Invalid next state');
                }
                log.debug(`But is allowed since user is admin`);
            }

            // Call to see if we can exit state
            if (docState.exit) {
                await this.assertInUserGroups(ctx, docState.exit, type, doc);
            }

            const newDocState = await this.getDocState(ctx, ds.type, newState);
            if (hasNonStateChange) {
                // Make sure caller is authorized to write in this new state
                log.debug(
                    `Checking permission for '${caller}' to write to state '${newState}'`
                );
                await this.assertWriteAccess(ctx, ds.type, doc);
                if (docState.onWrite) {
                    await docState.onWrite(
                        new StateCallbackContextImpl(
                            ctx,
                            this,
                            type,
                            this.toInfo(doc, true)
                        )
                    );
                }
            }

            // Call to see if we can enter next state
            if (newDocState.entry) {
                await this.assertInUserGroups(
                    ctx,
                    newDocState.entry,
                    type,
                    doc
                );
            }

            // Run action when leaving this state & before entering next state
            const action = docState.nextStates[args.state]?.action;
            if (action) {
                await action(
                    new StateCallbackContextImpl(
                        ctx,
                        this,
                        type,
                        this.toInfo(doc, true)
                    )
                );
            }

            // Run code when entering new state
            if (doc.state == newState && newDocState.onReentry) {
                await newDocState.onReentry(
                    new StateCallbackContextImpl(
                        ctx,
                        this,
                        type,
                        this.toInfo(doc, true)
                    )
                );
            } else if (newDocState.onEntry) {
                await newDocState.onEntry(
                    new StateCallbackContextImpl(
                        ctx,
                        this,
                        type,
                        this.toInfo(doc, true)
                    )
                );
            }

            // Cache read, write in document for current state
            args.curStateRead =
                (await this.getInUserGroups(
                    ctx,
                    newDocState.read,
                    type,
                    doc
                )) || [];
            args.curStateWrite =
                (await this.getInUserGroups(
                    ctx,
                    newDocState.write,
                    type,
                    doc
                )) || [];
        } else if (hasNonStateChange) {
            // Make sure caller is authorized to write in the current state
            log.debug(
                `Checking permission for '${caller}' to write to state '${doc.state}'`
            );
            await this.assertWriteAccess(ctx, ds.type, doc);
            if (docState.onWrite) {
                await docState.onWrite(
                    new StateCallbackContextImpl(
                        ctx,
                        this,
                        type,
                        this.toInfo(doc, true)
                    )
                );
            }
            // if (admin) {
            //     log.debug(`Write state granted for ${caller} because user is admin`);
            // }
            // else {
            //     await this.assertInUserGroups(ctx, docState.write, doc);
            // }
            // Cache read, write in document for current state
            args.curStateRead =
                (await this.getInUserGroups(ctx, docState.read, type, doc)) ||
                [];
            args.curStateWrite =
                (await this.getInUserGroups(ctx, docState.write, type, doc)) ||
                [];
        }

        // Update the doc
        const pc = await this.getDocCollection(ds.type);
        const newArgs = await this.updateArgs(ctx, ds, args);
        await pc.updateOne(this.idFilter(ds.id), this.toMongoUpdate(newArgs));

        // Return the updated doc
        return await this._getDoc(ctx, ds);
    }

    /**
     * Deletes a document.
     *
     * @param {UserContext} ctx - The user context
     * @param {DocSpec} ds - The specification of the document to be deleted
     * @returns {Promise<any>} The deleted document
     */
    public async deleteDoc(ctx: UserContext, ds: DocSpec): Promise<any> {
        log.debug(`Deleting doc: ${JSON.stringify(ds)}`);
        ctx.docId = ds.id;
        ctx.mode = 'delete';
        const doc = await this._getDoc(ctx, ds);
        const docState = await this.getDocState(ctx, ds.type, doc.state);
        if (docState.delete) {
            await this.assertDeleteAccess(ctx, ds.type, doc);
        } else {
            await this.assertWriteAccess(ctx, ds.type, doc);
        }

        if (docState.onDelete) {
            await docState.onDelete(
                new StateCallbackContextImpl(
                    ctx,
                    this,
                    ds.type,
                    this.toInfo(doc, true)
                )
            );
        }

        // const admin = await this.isAdmin(ctx);
        // if (!admin) {
        //     await this.assertInUserGroups(ctx, docState.write, doc);
        // }
        const pc = await this.getDocCollection(ds.type);
        await pc.deleteOne(this.idFilter(ds.id));
        log.debug(`Deleted doc: ${JSON.stringify(ds)}`);
        return doc;
    }

    /**
     * Create a new user group.
     *
     * @param {UserContext} ctx - The user context.
     * @param {UserGroupCreate} args - The user group creation parameters.
     * @param {Person[]} [defaultMembers] - The default members of the user group.
     * @returns {Promise<UserGroupInfo>} The created user group information.
     */
    public async createUserGroup(
        ctx: UserContext,
        args: UserGroupCreate,
        defaultMembers?: Person[]
    ): Promise<UserGroupInfo> {
        log.debug(`Creating user group: ${JSON.stringify(args)}`);
        await this.assertAdmin(ctx);
        const uc = await this.getUserCollection();
        const result = await uc.findOne({ id: args.id });
        if (result) {
            return throwErr(400, `User group '${args.id}' already exists`);
        }
        args.deletable = args.deletable || false;
        args.members = args.members || defaultMembers || [];
        await uc.insertOne(args);
        return await this.getUserGroup(ctx, args.id);
    }

    /**
     * Retrieve user groups.
     *
     * @param {UserContext} ctx - The user context.
     * @returns {Promise<UserGroupList>} An object containing the count of items and the items themselves.
     */
    public async getUserGroups(): Promise<UserGroupList> {
        const uc = await this.getUserCollection();
        const items: any = await uc.find().toArray();
        return { count: items.length, items };
    }

    /**
     * Retrieves a user group based on the provided id.
     *
     * @param {UserContext} ctx - The user context.
     * @param {string} id - The id of the user group to lookup.
     * @returns {Promise<UserGroupInfo | undefined>} The user group information if found, otherwise undefined.
     */
    public async lookupUserGroup(
        ctx: UserContext,
        id: string
    ): Promise<UserGroupInfo | undefined> {
        log.debug(`Getting user group '${id}'`);
        if (this.userGroupCache[id]) {
            log.debug(` -- found user group ${id} in cache`);
            return this.userGroupCache[id];
        }
        const uc = await this.getUserCollection();
        const result = await uc.findOne({ id: id });
        if (result) {
            const info = this.toInfo(result, false);
            this.userGroupCache[id] = info;
            // log.debug(`Got user group: '${JSON.stringify(info,null,4)}'`);
            return info;
        }
        log.debug(`User group '${id}' was not found`);
        return undefined;
    }

    /**
     * Retrieves a user group based on the provided id.
     *
     * @param {UserContext} ctx - The user context.
     * @param {string} id - The id of the user group to lookup.
     * @returns {Promise<UserGroupInfo>} The user group information if found, otherwise an error is thrown.
     */
    public async getUserGroup(
        ctx: UserContext,
        id: string
    ): Promise<UserGroupInfo> {
        const info = await this.lookupUserGroup(ctx, id);
        if (info) {
            // log.debug(`Got user group: '${JSON.stringify(info,null,4)}'`);
            return info;
        }
        return throwErr(404, `user group '${id}' was not found`);
    }

    /**
     * Get or create a user group.
     *
     * @param {UserContext} ctx - The user context.
     * @param {UserGroupCreate} args - The user group creation parameters.
     * @param {Person[]} [defaultMembers] - The default members of the user group.
     * @returns {Promise<UserGroupInfo>} The created or retrieved user group information.
     */
    public async getOrCreateUserGroup(
        ctx: UserContext,
        args: UserGroupCreate,
        defaultMembers?: Person[]
    ): Promise<UserGroupInfo> {
        log.debug(`Get or create user group: ${JSON.stringify(args)}`);
        if (this.userGroupCache[args.id]) {
            log.debug(` -- found user group ${args.id} in cache`);
            return this.userGroupCache[args.id];
        }
        const uc = await this.getUserCollection();
        const result = await uc.findOne({ id: args.id });
        if (result) {
            log.debug(`User group ${args.id} already exists`);
            return this.toInfo(result, false);
        }
        return await this.createUserGroup(ctx, args, defaultMembers);
    }

    /**
     * Updates a user group.
     *
     * @param {UserContext} ctx - The user context.
     * @param {string} id - The id of the user group to update.
     * @param {UserGroupUpdate} args - The updated user group information.
     * @returns {Promise<UserGroupInfo>} The updated user group information.
     */
    public async updateUserGroup(
        ctx: UserContext,
        id: string,
        args: UserGroupUpdate
    ): Promise<UserGroupInfo> {
        log.debug(`Updating user group '${id}': ${JSON.stringify(args)}`);
        await this.assertAdmin(ctx);
        const uc = await this.getUserCollection();
        await uc.updateOne({ id }, this.toMongoUpdate(args));
        if (this.userGroupCache[id]) {
            delete this.userGroupCache[id];
        }
        return await this.getUserGroup(ctx, id);
    }

    /**
     * Deletes a user group by ID after checking if it is deletable.
     *
     * @param {UserContext} ctx - the user context
     * @param {string} id - the ID of the user group to delete
     * @returns {Promise<UserGroupInfo>} the deleted user group information
     */
    public async deleteUserGroup(
        ctx: UserContext,
        id: string
    ): Promise<UserGroupInfo> {
        log.debug(`Deleting user group '${id}'`);
        await this.assertAdmin(ctx);
        const result = await this.getUserGroup(ctx, id);
        if (!result.deletable) {
            return throwErr(403, `The '${id}' user group can not be deleted`);
        }
        const uc = await this.getUserCollection();
        await uc.deleteOne({ id });
        if (this.userGroupCache[id]) {
            delete this.userGroupCache[id];
        }
        return result;
    }

    /**
     * Determine if the current user is in the user group
     *
     * @param ctx The user context
     * @param groupName Group name
     * @param doc The document
     *
     * @returns true if user in group, false if no
     */
    public async isInUserGroup(
        ctx: UserContext,
        groupName: string,
        type?: string,
        doc?: any
    ): Promise<boolean> {
        log.debug('isInUserGroup: user=', ctx.user.email, 'group=', groupName);
        if (ctx.user.roles.includes(groupName)) {
            return true;
        }
        const members = await this.getMembers(ctx, groupName, type, doc);
        const email = ctx.user.email;
        if (members) {
            for (const member of members) {
                if (member.email === email) {
                    log.debug(`${email} is in group ${groupName}`);
                    return true;
                }
            }
        }
        log.debug(
            `${email} was not found in group ${groupName}: ${JSON.stringify(members)}`
        );
        return false;
    }

    /**
     * Get all the Persons in a group.
     *
     * @param ctx The user context
     * @param groupName The group name can be a field in the document that is of type Person, or a group document from the group collection
     * @param doc The document
     * @returns Array of Persons that are in the group
     */
    protected async getMembers(
        ctx: UserContext,
        groupName: string,
        type?: string,
        doc?: any
    ): Promise<Person[]> {
        log.debug('getMembers: groupName=', groupName);
        const roles = await this.getDocRoles(ctx, type);
        if (roles[groupName]) {
            log.debug('  -- group found in docRoles');
            const m = roles[groupName].getMembers;
            if (typeof m === 'function') {
                if (doc && type) {
                    log.debug('  -- role is a function, so call getMembers()');
                    return await m(
                        new StateCallbackContextImpl(
                            ctx,
                            this,
                            type,
                            this.toInfo(doc, true)
                        )
                    );
                }
                log.debug(
                    '  -- role is a function, but no doc, so return [] members'
                );
                return [];
            } else {
                groupName = m;
                log.debug(
                    '  -- role is a string, so getMembers() for user group ',
                    m
                );
                return await this._getMembers(ctx, m, doc);
            }
        }
        log.debug(
            '  -- group not found in docRoles, so getMembers() for user group ',
            groupName
        );
        return await this._getMembers(ctx, groupName, doc);
    }

    protected async _getMembers(
        ctx: UserContext,
        groupName: string,
        doc?: any
    ): Promise<Person[]> {
        if (doc) {
            try {
                return getField(groupName, doc);
            } catch (e) {}
        }
        const ug = await this.lookupUserGroup(ctx, groupName);
        if (!ug) {
            return [];
        }
        return ug.members;
    }

    /**
     * Determine if the current user is in one of the user groups
     *
     * @param ctx The user context
     * @param groupNames Array of groups
     * @param doc The document
     * @param fromIsAdmin True=don't check to see if user is an admin (used if this method is called from inside isAdmin() to prevent recurssion)
     *
     * @returns true if in one of the groups, false if not
     */
    public async isInUserGroups(
        ctx: UserContext,
        groupNames: string[],
        type?: string,
        doc?: any,
        fromIsAdmin?: boolean
    ): Promise<boolean> {
        for (const groupName of groupNames) {
            const isMember = await this.isInUserGroup(
                ctx,
                groupName,
                type,
                doc
            );
            if (isMember) {
                return true;
            }
        }

        if (!fromIsAdmin) {
            const admin = await this.isAdmin(ctx);
            if (admin) {
                log.debug(
                    `${ctx.user.email} is Admin so it is given access for groups ${JSON.stringify(groupNames)}`
                );
                return true;
            }
        }
        return false;
    }

    /**
     * Assert that the current user is in the group.
     *
     * @param ctx The user context
     * @param arg Array of groups or Function that returns array of groups [optional].  If undefined, then all users are allowed.
     * @param doc The document
     *
     * @throws 401 error if user is not in group
     */
    public async assertInUserGroups(
        ctx: UserContext,
        arg: StateCallback | string[] | undefined,
        type: string,
        doc: any
    ) {
        if (arg === undefined) {
            return;
        }
        const groups = await this.getInUserGroups(ctx, arg, type, doc);
        // if (await this.isAdmin(ctx)) { return; }
        if (!groups || groups.length == 0) {
            throwErr(401, `${ctx.user.email} is not authorized`);
        }
        log.debug(`assertInUserGroups: groups=${JSON.stringify(groups)}`);
        const ok = await this.isInUserGroups(ctx, groups, type, doc);
        if (!ok) {
            if (await this.isAdmin(ctx)) {
                return;
            }
            throwErr(401, `${ctx.user.email} is not authorized`);
        }
    }

    /**
     * Get the array of user groups.
     * This method is useful if the arg is a function, then it calls the function to calculate the array of user groups.
     *
     * @param ctx The user context
     * @param arg Array of groups or Function that returns array of groups
     * @param doc The document
     *
     * @returns Array of groups
     */
    public async getInUserGroups(
        ctx: UserContext,
        arg: StateCallback | string[] | undefined,
        type: string,
        doc: any
    ) {
        if (typeof arg === 'function') {
            return (
                await arg(
                    new StateCallbackContextImpl(
                        ctx,
                        this,
                        type,
                        this.toInfo(doc, true)
                    )
                )
            ).groups;
        } else {
            return arg;
        }
    }

    /**
     * Determine if current user is an admin.
     *
     * @param ctx The user context
     *
     * @returns true if user is admin, false if not
     */
    // NOTE: ctx is in session cookie, so ctx.isAdmin is only good for the session
    public async isAdmin(ctx: UserContext): Promise<boolean> {
        const uid = ctx.user.id;
        log.debug(`isAdmin: uid=${uid} adminIds=${adminIds}`);
        if (ctx.isAdmin == undefined) {
            if (adminIds.indexOf(uid) >= 0) {
                log.debug(`${uid} is an ADMIN id`);
                ctx.isAdmin = true;
                return true;
            }
            if (ctx.user.roles.includes(this.adminRole)) {
                log.debug(`${uid} has ADMIN role`);
                ctx.isAdmin = true;
                return true;
            }
            const r = await this.isInUserGroups(
                ctx,
                this.adminGroups,
                undefined,
                undefined,
                true
            );
            ctx.isAdmin = r;
            return r;
        }
        if (ctx.isAdmin) {
            log.debug(`${uid} is an ADMIN id from cache`);
            return true;
        }
        log.debug(`${uid} is NOT ADMIN id from cache`);
        return false;
    }

    /**
     * Assert that the current user is an admin.
     *
     * @param ctx The user context
     * @returns
     * @throws 401 error if user is not admin
     */
    public async assertAdmin(ctx: UserContext) {
        const ok = await this.isAdmin(ctx);
        if (!ok) {
            return throwErr(401, `Caller is not admin`);
        }
    }

    /**
     * Creates an attachment using the provided arguments.
     *
     * @param {UserContext} ctx - The user context.
     * @param {any} args - The arguments for creating the attachment.
     * @returns {Promise<AttachmentModel>} The created attachment.
     */
    public async createAttachment(
        ctx: UserContext,
        args: any
    ): Promise<AttachmentModel> {
        log.debug(
            `Creating attachment: ${JSON.stringify(this.toAttachmentInfoString(args))}`
        );
        const pc = await this.getAttachmentCollection();
        const result = await pc.insertOne(args);
        const id = result.insertedId.toString();
        return await this.getAttachment(ctx, id);
    }

    /**
     * Retrieves an attachment based on the provided ID.
     *
     * @param {UserContext} _ctx - The user context.
     * @param {string} id - The ID of the attachment to retrieve.
     * @returns {Promise<AttachmentModel>} The retrieved attachment.
     */
    public async getAttachment(
        _ctx: UserContext,
        id: string
    ): Promise<AttachmentModel> {
        log.debug(`Getting attachment '${id}'`);
        const pc = await this.getAttachmentCollection();
        const result: any = await pc.findOne(this.idFilter(id));
        if (result) {
            return result;
        }
        return throwErr(404, `attachment '${id}' was not found`);
    }

    /**
     * Retrieves an attachment for a specific document.
     *
     * @param {UserContext} _ctx - The user context.
     * @param {string} docId - The ID of the document.
     * @param {string} id - The ID of the attachment.
     * @returns {Promise<AttachmentModel>} The retrieved attachment.
     */
    public async getAttachmentForDoc(
        _ctx: UserContext,
        docId: string,
        id: string
    ): Promise<AttachmentModel> {
        log.debug(`Getting attachment '${id}' for doc '${docId}'`);
        const pc = await this.getAttachmentCollection();
        const filter = this.idFilter(id);
        filter.doc = docId;
        const result: any = await pc.findOne(filter);
        if (result) {
            return result;
        }
        return throwErr(404, `attachment '${id}' was not found`);
    }

    /**
     * Retreive all attachments.
     *
     * @param {UserContext} _ctx - The user context.
     * @param {Object} args - Optional match and filter criteria.
     * @param {any} args.match - The matching criteria for attachments.
     * @param {any} args.filter - The filtering criteria for attachments.
     * @returns {Promise<AttachmentModel[]>} An array of retrieved attachments.
     */
    public async getAttachments(
        _ctx: UserContext,
        args?: { match?: any; filter?: any }
    ): Promise<AttachmentModel[]> {
        log.debug(`Getting attachments`);
        const pc = await this.getAttachmentCollection();
        args = args || {};
        const match = args.match || {};
        const result = (await pc.find(match).toArray()).map(p => {
            log.debug(JSON.stringify(this.toAttachmentInfoString(p)));
            return p as any;
        });
        return result;
    }

    /**
     * Updates an attachment with the specified ID.
     *
     * @param {UserContext} ctx - The user context.
     * @param {string} id - The ID of the attachment.
     * @param {any} args - The arguments for updating the attachment.
     * @returns {Promise<AttachmentModel>} The updated attachment.
     */
    public async updateAttachment(
        ctx: UserContext,
        id: string,
        args: any
    ): Promise<AttachmentModel> {
        log.debug(`Updating attachment '${id}'`);
        const pc = await this.getAttachmentCollection();
        await pc.updateOne(this.idFilter(id), this.toMongoUpdate(args));
        return await this.getAttachment(ctx, id);
    }

    /**
     * Deletes an attachment based on the provided ID.
     *
     * @param {UserContext} ctx - The user context.
     * @param {string} id - The ID of the attachment to delete.
     * @returns {Promise<AttachmentModel>} The deleted attachment.
     */
    public async deleteAttachment(
        ctx: UserContext,
        id: string
    ): Promise<AttachmentModel> {
        log.debug(`Deleting attachment '${id}'`);
        const result = await this.getAttachment(ctx, id);
        const pc = await this.getAttachmentCollection();
        await pc.deleteOne(this.idFilter(id));
        return result;
    }

    // TODO: use maxTimeMinutes to implement queueing of notifications

    /**
     * Send email notification to list of recipients.
     *
     * @param ctx
     * @param doc The document
     * @param groups List of groups or email addresses to send to
     * @param subject The subject of the email
     * @param message The message of the email
     * @param fromEmail [optional] The sender's email address (if not specified, then it comes from the app's email address)
     * @param sendSingle [optional - not supported yet] Send the same message to everyone, rather than sending individual, custom message to each recipient
     * @param maxTimeMinutes [optional - not supported yet] Queue up emails and send in batches
     */
    public async sendNotifications(
        ctx: UserContext,
        type: string,
        doc: any,
        groups: string[],
        subject: string,
        message: string,
        fromEmail: string = '',
        attachments: EmailAttachment[] = [],
        sendSingle?: boolean
    ) {
        log.debug(
            `Sending notification to ${JSON.stringify(groups)}, subject: ${subject}, message: ${message}, fromEmail: ${fromEmail}`
        );
        /* eslint-disable @typescript-eslint/no-this-alias*/
        const self = this;
        /* eslint-enable @typescript-eslint/no-this-alias*/

        // Get email addresses for all members of groupName
        async function getEmailAddresses(
            ctx: UserContext,
            groupName: string,
            doc: any
        ) {
            if (groupName.indexOf('@') > -1) {
                try {
                    const profile =
                        await self.userProfileService.get(groupName);
                    const user = profile[0];
                    return [
                        {
                            name: user.user.name,
                            department: user.user.department,
                            email: user.user.email,
                            title: user.user.title,
                            employeeNumber: user.user.employeeNumber,
                        },
                    ];
                } catch (e) {}
                return [
                    {
                        email: groupName,
                        name: '',
                        title: '',
                        department: '',
                        employeeNumber: '',
                    },
                ];
            } else {
                return await self.getMembers(ctx, groupName, type, doc);
            }
        }

        const excludeEmails = [];
        for (const group of groups) {
            if (group.charAt(0) === '!') {
                excludeEmails.push(group.substring(1).toLowerCase());
            }
        }
        log.debug('Excluded emails=', excludeEmails);
        for (const group of groups) {
            if (group.charAt(0) != '!') {
                try {
                    const toEmails = await getEmailAddresses(ctx, group, doc);
                    const sendEmails = [];
                    for (const toEmail of toEmails) {
                        if (
                            !excludeEmails.includes(toEmail.email.toLowerCase())
                        ) {
                            sendEmails.push(toEmail);
                        }
                    }
                    if (sendEmails.length > 0) {
                        await this.sendEmailToGroup(
                            ctx,
                            sendEmails,
                            subject,
                            message,
                            fromEmail,
                            attachments,
                            sendSingle
                        );
                    }
                } catch (e: any) {
                    log.debug(e.message);
                }
            }
        }
    }

    /**
     * Send email to list of email addresses.
     *
     * @param ctx
     * @param toEmails List of email addresses to send to
     * @param subject The subject of the email
     * @param message The message of the email
     * @param fromEmail [optional] The sender's email address (if not specified, then it comes from the app's email address)
     * @param sendSingle [optional - not supported yet] Send the same message to everyone, rather than sending individual, custom message to each recipient
     */
    public async sendEmailToGroup(
        ctx: UserContext,
        toEmails: Person[],
        subject: string,
        message: string,
        fromEmail: string = '',
        attachments: EmailAttachment[] = [],
        sendSingle?: boolean
    ) {
        // @TODO: Use regexp to make this generic for any Person object
        const processNotificationContent = (member: Person, s: string) => {
            s = s.replace(/%title%/g, member.title);
            try {
                s = s.replace(
                    /%name%/g,
                    member.name || member.email.split('@')[0]
                );
            } catch (e) {
                log.debug('Error substituting %name% in email');
            }
            s = s.replace(/%department%/g, member.department);
            s = s.replace(/%employeeNumber%/g, member.employeeNumber);
            s = s.replace(/%email%/g, member.email);
            return s;
        };
        for (const member of toEmails) {
            await this.sendEmail(
                ctx,
                member.email,
                processNotificationContent(member, subject),
                processNotificationContent(member, message),
                fromEmail,
                attachments,
                sendSingle
            );
        }
    }

    /**
     * Send email to an email address.
     *
     * @param ctx
     * @param toEmail Email address to send to
     * @param subject The subject of the email
     * @param message The message of the email
     * @param fromEmail [optional] The sender's email address (if not specified, then it comes from the app's email address)
     * @param force T=send email even if EMAIL_ENABLED env var is false
     * @param sendSingle [optional - not supported yet] Send the same message to everyone, rather than sending individual, custom message to each recipient
     * @returns
     */
    public async sendEmail(
        ctx: UserContext,
        toEmail: string,
        subject: string,
        message: string,
        fromEmail: string = '',
        attachments: EmailAttachment[] = [],
        force: boolean = false
    ) {
        const from = fromEmail || this.email;
        if (!emailEnabled && !force) {
            log.info(
                `Email notification is disabled.  Not sending notification email to ${toEmail}: subject=${subject}, message=${message}, from=${from}`
            );
            return;
        }
        /* eslint-disable @typescript-eslint/no-this-alias*/
        const self = this;
        /* eslint-enable @typescript-eslint/no-this-alias*/
        setTimeout(async function () {
            try {
                log.info(
                    `Sending notification email to ${toEmail}: subject=${subject}, message=${message}, from ${from}`
                );
                const isHtml = message.indexOf('</') > -1;
                await self.transporter.sendMail({
                    from: from,
                    to: toEmail,
                    // cc: "",
                    // bcc: "",
                    subject,
                    text: message,
                    html: isHtml ? message : undefined,
                    attachments: attachments,
                });
                log.info(`Sent notification email to ${toEmail}`);
            } catch (e: any) {
                log.info(`Failed to send email to ${toEmail}: ${e.stack}`);
            }
        }, 100);
    }

    /**
     * A function to export all data.
     * For applications with a large number of documents, exportIds() with exportId() should be used.
     *
     * @param {UserContext} ctx - The UserContext.
     * @returns {Promise<any>} A promise that resolves with the exported data.
     */
    public async export(ctx: UserContext): Promise<any> {
        log.debug('export: enter');
        await this.assertAdmin(ctx);
        const rtn: any = {};
        for (const cName of this.allCollectionNames) {
            const c = await this.getCollection(cName);
            rtn[cName] = await c.find({}).toArray();
        }
        //log.debug(`export: exit - ${JSON.stringify(rtn,null,4)}`);
        log.debug(`export: exit`);
        return rtn;
    }

    /**
     * A function to export the ids of all data.  Each id can then be exported using exportId().
     *
     * @param {UserContext} ctx - The UserContext to determine the data export.
     * @returns {Promise<any>} A promise that resolves with the exported data.
     */
    public async exportIds(ctx: UserContext): Promise<any> {
        await this.assertAdmin(ctx);
        log.debug('exportIds: enter');
        const rtn: any = {};
        for (const cName of this.allCollectionNames) {
            const c = await this.getCollection(cName);
            rtn[cName] = await c
                .find({})
                .project({ _id: 1 })
                .map(function (ele) {
                    return ele._id;
                })
                .toArray();
        }
        //log.debug(`exportIds: exit - ${JSON.stringify(rtn)}`);
        log.debug(`exportIds: exit`);
        return rtn;
    }

    /**
     * A function to export a single document by its id from a specific collection.
     *
     * @param {UserContext} ctx - The UserContext.
     * @param {string} cName - The name of the collection to export from.
     * @param {string} id - The id of the document to export.
     * @returns {Promise<any>} A promise that resolves with the exported document.
     */
    public async exportId(
        ctx: UserContext,
        cName: string,
        id: string
    ): Promise<any> {
        await this.assertAdmin(ctx);
        log.debug(`exportId: enter - ${cName} ${id}`);
        const c = await this.getCollection(cName);
        const rtn = await c.findOne(this.idFilter(id));
        log.debug(`exportId: exit - ${cName} ${id}: ${JSON.stringify(rtn)}`);
        return rtn;
    }

    /**
     * A function to import a single document by its id into a specific collection.
     *
     * @param {UserContext} ctx - The UserContext.
     * @param {string} cName - The name of the collection to import into.
     * @param {string} id - The id of the document to import.
     * @param {any} ele - The document to import.
     * @returns {Promise<any>} A promise that resolves with the imported document.
     */
    public async importId(
        ctx: UserContext,
        cName: string,
        id: string,
        ele: any
    ): Promise<any> {
        log.debug(`importId: enter - ${cName} ${id}`);
        await this.assertAdmin(ctx);
        try {
            const c = await this.getCollection(cName);
            delete ele._id;
            if (cName == this.attachmentCollectionName) {
                ele.data = Buffer.from(ele.data, 'base64');
            }
            await c.bulkWrite([
                {
                    updateOne: {
                        filter: this.idFilter(id),
                        update: { $set: ele },
                        upsert: true,
                    },
                },
            ]);
            const cur = await c.findOne(this.idFilter(id));
            log.debug(`importId: exit - ${cName} ${id}`);
            return cur;
        } catch (e) {
            log.err(`importId: Error importing attachment = ${e}`);
            return null;
        }
    }

    /**
     * A function to import data into collections based on the provided data.
     *
     * @param {UserContext} ctx - The UserContext.
     * @param {any} toImport - The data to be imported into collections.
     */
    public async import(ctx: UserContext, toImport: any) {
        //log.debug(`import: enter - ${JSON.stringify(toImport,null,4)}`);
        log.debug(`import: enter`);
        await this.assertAdmin(ctx);
        for (const cName in toImport) {
            log.debug(`     importing collection ${cName}`);
            const contents = toImport[cName];
            const c = await this.getCollection(cName);
            for (const entry of contents as any[]) {
                if (!entry.hasOwnProperty('_id')) {
                    return throwErr(
                        400,
                        `The following ${cName} entry has no '_id' field: ${JSON.stringify(entry)}`
                    );
                }
                const id = entry['_id'];
                const result: any = await c.findOne(this.idFilter(id));
                if (result) {
                    log.debug(
                        `         not inserting ${id} because it was already found`
                    );
                } else {
                    log.debug(`        inserting ${id}`);
                    await c.insertOne(entry);
                }
            }
        }
        log.debug(`import: exit`);
    }

    /**
     * A function to delete all collections in the database.
     *
     * @param {UserContext} ctx - The UserContext for the reset operation.
     * @param {boolean} simpleInit - Optional parameter to indicate simple initialization.
     */
    public async reset(ctx: UserContext, simpleInit: boolean = false) {
        log.info('reset: enter');
        await this.assertAdmin(ctx);
        for (const cName of this.allCollectionNames) {
            log.info(`    dropping collection ${cName}`);
            const c = await this.getCollection(cName);
            try {
                await c.drop();
            } catch (e: any) {
                log.info(`Failed to drop collection ${cName}: ${e.message}`);
            }
        }

        // DocMgr object is no longer initialized and the user collection
        //  has been cleared.  Reflect this before init() is called.
        this.initialized = false;
        this.initHasBeenCalled = false;
        this.userGroupCache = {};
        await this.init(simpleInit);
        log.info('reset: exit');
    }

    /**
     * A function to get the UserContext from the request.
     *
     * @param {any} req - The request object.
     * @returns {UserContext} The UserContext retrieved from the request.
     */
    public getCtx(req: any): UserContext {
        const ctx = req._ctx;
        if (!ctx) {
            throwErr(500, "No '_ctx' field was found on request");
        }
        return ctx;
    }

    /**
     * A function to get the email of the user from the UserContext.
     *
     * @param {UserContext} ctx - The UserContext containing user information.
     * @returns {string} The email of the user from the UserContext.
     */
    public getMyUserMatchValue(ctx: UserContext): string {
        return ctx.user.email;
    }

    /**
     * Creates a filter object to match the email field of the specified object field with the email of the user context.
     *
     * @param {UserContext} ctx - The user context containing the user information.
     * @param {string} field - The field in the object to match the email with.
     * @returns {Object} The filter object to match the email field.
     */
    public createMyUserMatchFilter(ctx: UserContext, field: string): object {
        const filter: any = {};
        // The ".email" matches the email field of the Person object in interfaces.ts of base
        filter[`${field}.email`] = this.getMyUserMatchValue(ctx);
        return filter;
    }

    /**
     * A function to convert an object into a format suitable for MongoDB update operation.
     *
     * @param {any} obj - The object to be converted.
     * @returns {any} The formatted object for MongoDB update.
     */
    public toMongoUpdate(obj: any): any {
        const setObj: any = {};
        const result: any = { $set: setObj };
        Object.keys(obj).forEach(function (key: string) {
            const val = obj[key];
            if (key.startsWith('$')) {
                if (!(key in result)) {
                    result[key] = {};
                }
                result[key] = { ...result[key], ...val };
            } else if (key === 'state') {
                setObj[key] = val.split('$')[0];
            } else {
                setObj[key] = val;
            }
        });
        return result;
    }

    /**
     * A function to retrieve the collection of documents based on the specified type.
     *
     * @param {string} type - The type of the document collection to retrieve.
     * @returns {Promise<mongoose.Collection>} The collection of documents based on the specified type.
     */
    public async getDocCollection(type: string): Promise<mongoose.Collection> {
        return await this.getCollection(this.getDocCollectionName(type));
    }

    /**
     * Retrieves the user collection.
     *
     * @returns {Promise<mongoose.Collection>} The user collection.
     */
    public async getUserCollection(): Promise<mongoose.Collection> {
        return await this.getCollection(this.userCollectionName);
    }

    /**
     * A function to retrieve the attachment collection.
     *
     * @returns {Promise<mongoose.Collection>} The attachment collection.
     */
    public async getAttachmentCollection(): Promise<mongoose.Collection> {
        return await this.getCollection(this.attachmentCollectionName);
    }

    private collectionCount = 0;
    /**
     * A function to get a collection based on the provided name.
     *
     * @param {string} name - The name of the collection to retrieve.
     * @returns {Promise<mongoose.Collection>} The collection retrieved based on the provided name.
     */
    public async getCollection(name: string): Promise<mongoose.Collection> {
        this.collectionCount++;
        const conn = await this.getConnection();
        const rtn = conn.collection(name);
        return rtn;
    }

    /**
     * A funciton to get a list of all collections
     * @returns {string[]} Array of collection names
     */
    public async getCollectionList(): Promise<string[]>{
        const conn = await this.getConnection();
        const rtn = Object.keys(conn.collections);
        return rtn;
    }

    /**
     * A function to get the collection name based on the provided type.
     *
     * @param {string} type - The type of the document.
     * @returns {string} The collection name based on the provided type.
     */
    public getDocCollectionName(type: string): string {
        const cName = this.documents[type].collectionName;
        if (cName) {
            return `${this.appName}.${cName}`;
        }
        return `${this.appName}.${type}.doc`;
    }

    /**
     * A function to get the id filter from the document specification.
     *
     * @param {DocSpec} ds - The document specification
     * @returns {any} The id filter
     */
    public docFilter(ds: DocSpec): any {
        return this.idFilter(ds.id);
    }

    /**
     * A function to get the id filter for the id.
     *
     * @param {string} id - The id
     * @returns {any} The id filter
     */
    public idFilter(id: string): any {
        try {
            return { _id: new ObjectId(id) };
        } catch (BSONTypeError) {
            return { _id: id };
        }
    }

    private registeredForConnectionEvents = false;

    /**
     * A function to establish a connection to the database.
     *
     * @returns {Promise<mongoose.Connection>} The connection to the database
     */
    protected async getConnection(): Promise<mongoose.Connection> {
        if (!this.registeredForConnectionEvents) {
            mongoose.connection.on('connected', () => {
                log.info(`Database connected`);
                this.connected = true;
            });
            mongoose.connection.on('disconnected', () => {
                log.err(`Database disconnected`);
                this.connected = false;
            });
            mongoose.connection.on('error', err => {
                log.err(`Database connection error: ${err.message}`);
                this.connected = false;
            });
            this.registeredForConnectionEvents = true;
        }
        if (!this.connected) {
            log.info('Connecting to database ...');
            const opts = {
                serverSelectionTimeoutMS: 10000,
                useUnifiedTopology: true,
            };
            try {
                await mongoose.connect(this.mongoUrl, opts);
                log.info('Connected to database');
                this.connected = true;
            } catch (e: any) {
                log.err(`Failed to connect to database: ${e.message}`);
                throw e;
            }
            await this.init();
        }
        return mongoose.connection;
    }

    /**
     * A function to get the base URL.
     *
     * @returns {string} The base URL
     */
    public getBaseUrl() {
        return this.cfg('URL', 'http://127.0.0.1:3001');
    }

    /**
     * A function to get the MongoDB connection URL based on the environment variables.
     *
     * @returns {string} The MongoDB connection URL
     */
    protected getMongoUrl() {
        const user = process.env['MONGO_USER'];
        const pass = process.env['MONGO_PASS'];
        let prefix = '';
        if (user || pass) {
            prefix = `${user}:${pass}@`;
        }
        return `mongodb://${prefix}${this.mcfg('HOST', '127.0.0.1')}:${this.mcfg('PORT', '27017')}`;
    }

    /**
     * A function to get the MongoDB configuration value.
     *
     * @param {string} name - The name of the configuration value
     * @param {string} def - The default value if the configuration is not found
     * @returns {string} The configuration value
     */
    public mcfg(name: string, def?: string): string {
        return this.cfg(`MONGO_${name}`, def);
    }

    /**
     * A function to get the environment configuration value.
     *
     * @param {string} name - The name of the configuration value
     * @param {string} def - The default value if the configuration is not found
     * @returns {string} The configuration value
     */
    public cfg(name: string, def?: string): string {
        const rtn = process.env[name];
        if (!rtn) {
            if (def) {
                return def;
            }
            return throwErr(500, `${name} environment variable is not set`);
        }
        return rtn;
    }

    /**
     * A function to transform a document into an info object.
     *
     * @param {any} doc - The document to transform
     * @param {boolean} copy - Flag to indicate if the document should be copied
     * @returns {any} The transformed info object
     */
    public toInfo(doc: any, copy: boolean): any {
        if (copy) {
            doc = JSON.parse(JSON.stringify(doc));
        }
        if (!('id' in doc)) {
            if ('_id' in doc) {
                const id = doc._id.toString();
                doc = { id, ...doc };
            }
        }
        delete doc._id;
        return doc;
    }

    /**
     * A function to transform the attachment information string representation.
     *
     * @param {any} ele - The attachment information object
     * @returns {any} The transformed attachment information object
     */
    public toAttachmentInfoString(ele: any): any {
        if ('data' in ele) {
            ele = { ...ele, data: '...' };
        }
        return ele;
    }

    /**
     * A function to check if the input object has any key other than "state".
     *
     * @param {any} args - The input object to check for keys.
     * @returns {boolean} True if any key other than "state" is found, false otherwise.
     */
    public hasNonStateKey(args: any): boolean {
        for (const key of Object.keys(args)) {
            if (key !== 'state') {
                return true;
            }
        }
        return false;
    }
}

class StateCallbackContextImpl implements StateCallbackContext {
    public caller: PersonWithId;
    public document: DocInfo;
    public type: string;
    public updates: any;

    private ctx: UserContext;
    private mgr: DocMgr;
    private doc: any;

    /**
     * Constructor for StateCallbackContextImpl class.
     *
     * @param {UserContext} ctx - The user context
     * @param {DocMgr} mgr - The document manager
     * @param {string} type - The type of the document
     * @param {any} doc - The document object
     */
    constructor(ctx: UserContext, mgr: DocMgr, type: string, doc: any) {
        this.caller = ctx.user;
        this.document = doc;
        this.type = type;
        this.updates = ctx.updates;
        this.ctx = ctx;
        this.mgr = mgr;
        this.doc = doc;
    }

    /**
     * Check if the caller is in a specific group.
     *
     * @param {string[]} groups - The groups to check against
     * @returns {Promise<boolean>} Promise that resolves to a boolean indicating if the caller is in the specified group
     */
    public async isCallerInGroup(groups: string[]): Promise<boolean> {
        return await this.mgr.isInUserGroups(
            this.ctx,
            groups,
            this.type,
            this.doc
        );
    }

    /**
     * Asserts that the caller is in one of the specified groups.
     *
     * @param {string[]} groups - The groups to check against.
     */
    public async assertCallerInGroup(groups: string[]) {
        await this.mgr.assertInUserGroups(
            this.ctx,
            groups,
            this.doc,
            this.type
        );
    }

    /**
     * Notify users in specific groups with a message.
     *
     * @param {string[]} groups - The groups to notify
     * @param {string} subject - The subject of the notification
     * @param {string} message - The message content
     * @param {string} fromEmail - (Optional) The sender's email
     * @param {EmailAttachment[]} attachments - (Optional) Attachments to include
     * @param {boolean} sendSingle - [optional - not supported yet] Send the same message to everyone, rather than sending individual, custom message to each recipient
     * @param {number} maxTimeMinutes - [optional - not supported yet] Queue up emails and send in batches
     * @returns {Promise<void>} Promise that resolves once the notification is sent
     */
    public async notify(
        groups: string[],
        subject: string,
        message: string,
        fromEmail: string = '',
        attachments: EmailAttachment[] = [],
        sendSingle?: boolean
    ) {
        await this.mgr.sendNotifications(
            this.ctx,
            this.type,
            this.doc,
            groups,
            subject,
            message,
            fromEmail,
            attachments,
            sendSingle
        );
    }

    /**
     * Get the user context.
     *
     * @returns {UserContext} The user context
     */
    public getUserContext(): UserContext {
        return this.ctx;
    }

    /**
     * Get the document manager.
     *
     * @returns {DocMgr} The document manager
     */
    public getDocMgr(): DocMgr {
        return this.mgr;
    }

    /**
     * Throws an error for access denied.
     *
     * @param {void} - No parameters
     * @returns {void} No return value
     */
    public accessDeniedError(): void {
        throwErr(401, 'Access denied');
    }

    /**
     * Checks if the context mode is set to "create".
     *
     * @returns {boolean} True if the context mode is "create", false otherwise
     */
    isCreate(): boolean {
        return this.ctx.mode === 'create';
    }

    /**
     * Checks if the context mode is set to "read".
     *
     * @returns {boolean} True if the context mode is "read", false otherwise
     */
    isRead(): boolean {
        return this.ctx.mode === 'read';
    }

    /**
     * Checks if the context mode is set to "update".
     *
     * @returns {boolean} True if the context mode is "update", false otherwise
     */
    isUpdate(): boolean {
        return this.ctx.mode === 'update';
    }

    /**
     * Checks if the context mode is set to "delete".
     *
     * @returns {boolean} True if the context mode is "delete", false otherwise
     */
    isDelete(): boolean {
        return this.ctx.mode === 'delete';
    }
}
