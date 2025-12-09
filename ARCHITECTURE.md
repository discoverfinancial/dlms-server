# DLMS Architecture

### Overview

DLMS stands for "Document Lifecycle Management System".  DLMS contains the common code for various DLMS-based applications such as:

* patent management
* concept proposal management
* inner source management
* and others

The goal is to make it as easy as possible to develop new DLMS applications for DFS.

### Benefits

The benefits of DLMS are as follows:

* Minimizes the time-to-value for building and supporting any application which needs to manage the lifecycle of a document
* Maximizes the quality of applications because of increased sharing of code, services, etc
* Maximizes productivity because these applications are now easy to create, support, and use
* Increases skills of developers within DFS as we make it easier for others to build these types of applications
* Fosters greater degree of collaboration within DFS

### Architectural Decision Records

This section contains an ADR (Architectural Decision Record) for each decision which has been made for DLMS.

1. [Use mongo as the database](decisions/MONGO.md#use-mongo)
