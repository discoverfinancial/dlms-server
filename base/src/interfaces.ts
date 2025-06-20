/**
 * Copyright (c) 2024 Discover Financial Services
 */

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

export interface UserGroupCreate {
    id: string;
    members?: Person[];
    deletable?: boolean;
    [key: string]: any;
}

export interface UserGroupUpdate {
    members?: Person[];
    [key: string]: any;
}

export interface UserGroupInfo {
    id: string;
    members: Person[];
    deletable: boolean;
    [key: string]: any;
}

export interface UserGroupList {
    count: number;
    items: UserGroupInfo[];
}

export interface AttachmentInfo {
    id: string;
    hash: string;
    collection?: string;
    doc?: string;
    name: string;
    size: number;
    date: number;
    type: string;
    url: string;
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

export interface DocCreate {
}
export interface DocInfo {
    id: string;
}

export interface DocUpdate {
}

export interface DocList {
    count: number;
    items: any[];
}

export interface EmailAttachment {
    filename: string;
    content: any;
    contentType?: string;
}

export interface StateActionCallbackReturn {
    document?: any;
}
export interface StateCallbackReturn  extends StateActionCallbackReturn {
    groups: string[];
}

export type MemberListCallback = (ctx: StateCallbackContext) => Promise<Person[]>;

export type StateCallback = (ctx: StateCallbackContext) => Promise<StateCallbackReturn>;

export type StateActionCallback = (ctx: StateCallbackContext) => Promise<StateActionCallbackReturn>;

export interface PumlState {
    title?: string;
    content: string[];
    color?: string;
    note?: string;
}

export interface PumlArc {
    title?: string;
    label: string[];
    color?: string;
    note?: string;
    direction?: "up" | "left" | "right" | "down";
}
export interface StateCallbackContext {
    isCallerInGroup(groups: string[]): Promise<boolean>;
    assertCallerInGroup(groups: string[]): Promise<void>;
    notify(groups: string[], subject: string, message: string, fromEmail?: string, attachments?: EmailAttachment[], sendSingle?: boolean, maxTimeMinutes?: number): Promise<void>;
    getUserContext(): UserContext;
    getDocMgr(): any;
    accessDeniedError(): void;
    caller: PersonWithId;
    document: any;
    updates: any; // {title: "This is the new title", ideator: "joe@example.com"}
    isCreate() : boolean;
    isRead() : boolean;
    isUpdate() : boolean;
    isDelete() : boolean;
}

export interface DocState {
    label: string;                      // Human readable label
    description: string;                // Description

    entry?: StateCallback | string[];   // Return groups who can enter this state
    onEntry?: StateActionCallback;      // Code that is run when entering the state
    onReentry?: StateActionCallback;    // Code that is run when reentering the same state.  If not set, then onEntry is called
    
    read?: StateCallback | string[];    // Return groups who can read document in this state
    onRead?: StateActionCallback;       // Code that is run when reading the state
    onAfterRead?: StateActionCallback;  // Code that is run after reading document, but before returning document
    
    write?: StateCallback | string[];   // Return groups who can write document in this state
    onWrite?: StateActionCallback;      // Code that is run when writing the state

    commentWrite?: StateCallback | string[];            // Return groups who can create comments
    commentReadPublic?: StateCallback | string[];       // TODO: Return groups who can read public comments
    commentReadPrivate?: StateCallback | string[];      // TODO: Return groups who can read private comments

    exit?: StateCallback | string[];    // Return groups who can exit this state
    onExit?: StateActionCallback;       // Code that is run when exiting the state
    
    delete?: StateCallback | string[];  // Return groups who can delete document in this state.  If not set, then write property is used.
    onDelete?: StateActionCallback;     // Code that is run when deleting the state
    
    action?: StateActionCallback;       // Code that can be run by calling /api/action endpoint
    puml?: PumlState;                   // Puml used to autogenerate state diagram
    nextStates: PossibleStates;         // Next states that can be moved to from this state
}

export interface DocStates  {
    [name: string]: DocState
}

export interface RoleEntry {
    name: string;
    getMembers: string | MemberListCallback;
}

export interface Roles {
    [name: string]: RoleEntry;
}

export interface NextState {
    groups: string[];                   // Groups who can enter next state
    label?: string;                     // Human readable label
    description?: string;               // Description
    puml?: PumlArc;                     // Puml used to autogenerate state diagram
    action?: StateActionCallback;       // Code to run when going to next state
    [key: string]: any;                 // Additional properties that can be used by the extending application (can be client and server side)
}

export interface PossibleStates {
    [key:string]: NextState;
}



export interface CommentHistory {
    date: number;
    user: Person;
}

export interface CommentInfo {
    id: string;
    date: number;
    user: Person;
    topic: string;
    text: string;
    edited?: CommentHistory[];
    approved?: string;
    private?: boolean;
}

export interface CommentCreate {
    topic: string;
    text: string;
    private?: boolean;
    approved?: string;
}

export  interface CommentUpdate {
    topic?: string;
    text?: string;
    private?: boolean;
    approved?: string;
}

export interface StateHistory {
    state: string;
    date: number;
    email?: string;
}
