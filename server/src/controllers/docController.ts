/**
 * Copyright (c) 2024 Discover Financial Services
 */
import * as express from 'express';
import {
    Body,
    Controller,
    Get,
    Path,
    Post,
    Patch,
    Delete,
    Query,
    Request,
    Route,
    Response,
    Example,
} from 'tsoa';
import { DocMgr } from '../docMgr';
import { DocList } from 'dlms-base';
@Route('/api/docs/{type}')
export class DocController extends Controller {
    /**
     * Create a document in the given collection.  User must have access
     * to create documents of the given type.
     * @param req
     * @param type DocType name
     * @param body Any object
     * @returns Newly created document retrieved from the DB
     */
    @Example<object>({ id: 'idValue', key3: 'value3', key4: 'value4' })
    @Response('401', 'User access denied')
    @Response(
        '401',
        'If documents of the given type are required to have an id and none was provided'
    )
    @Response('500', 'Internal Server Error.  Check database connection')
    @Post()
    public async createDoc(
        @Request() req: express.Request,
        @Path() type: string,
        @Body() body: any
    ): Promise<any> {
        const mgr = DocMgr.getInstance();
        return mgr.createDoc(mgr.getCtx(req), type, body);
    }

    /**
     * Create a document in the given collection with the
     * given unique id.  User must have access to create
     * documents of the given type.
     * @param req
     * @param type DocType name
     * @param id Document id
     * @param body Any object
     * @returns Newly created document retrieved from the DB
     */
    @Example<object>({ id: 'idValue', key3: 'value3', key4: 'value4' })
    @Response('401', 'User access denied')
    @Response(
        '401',
        'If documents of the given type are required to have an id and none was provided'
    )
    @Response('500', 'Internal Server Error.  Check database connection')
    @Post('{id}')
    public async createDocById(
        @Request() req: express.Request,
        @Path() type: string,
        @Path() id: string,
        @Body() body: any
    ): Promise<any> {
        const mgr = DocMgr.getInstance();
        return mgr.createDocById(mgr.getCtx(req), type, id, body);
    }

    /**
     * Retrieve documents of the given type that satisfy the
     * given match.  User must have access to read documents
     * of the given type.
     * @param req
     * @param type DocType name
     * @param match Optional, stringified JSON, specifies selection filter using query operators.
     * @param projection Optional, stringified JSON, specifies the fields to return in the documents that match the query filter.
     * @returns DocList object
     */
    @Example<DocList>({
        count: 3,
        items: [
            { key3: 'value3', key4: 'value4' },
            { key5: 'value5', key6: 'value6' },
            { key7: 'value7', key8: 'value8' },
        ],
    })
    @Response('401', 'User access denied')
    @Response('500', 'Internal Server Error.  Check database connection')
    @Get()
    public async getDocs(
        @Request() req: express.Request,
        @Path() type: string,
        @Query() match?: string,
        @Query() projection?: string
    ): Promise<any> {
        const mgr = DocMgr.getInstance();
        //const groups = (filter || "").split(',');
        const result = await mgr.getDocs(
            mgr.getCtx(req),
            type,
            match,
            projection
        );
        const rtn: any = {
            count: result.length,
            items: result,
        };
        return rtn;
    }

    /**
     * Retrieve the given document of the given type.  User
     * must have read access to this document in its current
     * state in order to retrieve it.
     * @param req
     * @param type DocType name
     * @param id Document id
     * @
     * @returns Document retrieved from DB
     */
    @Example<object>({ id: 'idValue', key3: 'value3', key4: 'value4' })
    @Response('401', 'User access denied')
    @Response('404', 'Document does not exist')
    @Response('500', 'Internal Server Error.  Check database connection')
    @Get('{id}')
    public async getDoc(
        @Request() req: express.Request,
        @Path() type: string,
        @Path() id: string
    ): Promise<any> {
        const mgr = DocMgr.getInstance();
        return mgr.getDoc(mgr.getCtx(req), { type, id });
    }

    /**
     * Update a document with the given id that lives in the
     * collection associated with the given DocType.  User
     * must have write access to update documents of the given
     * type.  If the update is a state change, user must be
     * authorized to change current state.
     * @param req
     * @param type DocType name
     * @param id Document id
     * @param args Any object with new property values to change
     * @returns Updated document retrieved from DB
     */
    @Example<object>({ id: 'idValue', key3: 'value3', key4: 'value4' })
    @Response('401', 'User access denied')
    @Response('404', 'Document does not exist')
    @Response('500', 'Internal Server Error.  Check database connection')
    @Patch('{id}')
    public async updateDoc(
        @Request() req: express.Request,
        @Path() type: string,
        @Path() id: string,
        @Body() args: any
    ): Promise<any> {
        const mgr = DocMgr.getInstance();
        return mgr.updateDoc(mgr.getCtx(req), { type, id }, args);
    }

    /**
     * Delete the given document from the collection associated
     * with the given DocType.  User must have read and write
     * access to this document in its current state in order to
     * delete the document.
     * @param req
     * @param type DocType name
     * @param id Document id
     * @returns Document that was deleted
     */
    @Example<object>({ id: 'idValue', key3: 'value3', key4: 'value4' })
    @Response('401', 'User access denied')
    @Response('404', 'Document does not exist')
    @Response('500', 'Internal Server Error.  Check database connection')
    @Delete('{id}')
    public async deleteDoc(
        @Request() req: express.Request,
        @Path() type: string,
        @Path() id: string
    ): Promise<any> {
        const mgr = DocMgr.getInstance();
        return mgr.deleteDoc(mgr.getCtx(req), { type, id });
    }
}
