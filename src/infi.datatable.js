
var DataTableCollection = Backbone.Collection.extend({

    sort: '',
    page: 1,
    default_page_size: 100,
    metadata: {},
    filters: {},
    loading: false,
    local_storage_prefix: 'infi.datatable.',

    initialize: function(models, options) {
        // If there's a query string in the URL, restore the collection state from it
        var self = this;
        self.visibility = {}
        if (window.location.search) {
            self._restore_state_from_url();
        }
        // Local storage page size takes overrides query page size.
        this.load_state_from_storage();
        // Use default page size if both
        this.page_size = this.page_size || this.default_page_size;
        self._save_state_to_url(true /* replace */);

        // Update the collection state when BACK button is pressed
        window.addEventListener('popstate', function(e) {
            if (e.state) {
                self._restore_state_from_url();
            } else {
                self._reset_state();
            }
        });
    },

    _restore_state_from_url: function() {
        // Parse query string
        var params = {};
        window.location.search.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(str, key, value) {
            params[key] = decodeURIComponent(value);
        });
        // Get the parameters we know
        this.sort = params.sort || this.sort;
        this.page = parseInt(params.page || this.page);
        if (params.page_size) {
            this.page_size = parseInt(params.page_size);
        }

        // All the rest are persumed to be filters
        this.filters = _.omit(params, 'sort', 'page', 'page_size');
        // Trigger an event to allow views to update their state too
        this.trigger('state:restore');
        this.reload(false);
    },

    _reset_state: function() {
        this.sort = '';
        this.page = 1;
        this._set_page_size(this._get_page_size() || this.default_page_size);
        this.filters = {};
        this.trigger('state:reset');
        this.reload(false);
    },

    _save_state_to_url: function(replace) {
        var state = this.get_request_data();
        function serialize(obj) {
            var str = [];
            for (var p in obj) {
                str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
            }
            return str.join("&");
        }
        var query_string = '?' + serialize(state);
        if (replace) {
            history.replaceState(state, '', query_string + window.location.hash);
        } else if (query_string != window.location.search) {
            history.pushState(state, '', query_string + window.location.hash);
        }
    },

    /* Loading and saving the table state in session storage */

    get_storage_key: function() {
        return 'infi.datatable.' + this.id;
    },

    save_state_to_storage: function() {
        var state = {visibility: this.visibility, page_size: this.page_size};
        try {
            sessionStorage.setItem(this.get_storage_key(), JSON.stringify(state));
        } catch(e) {
        }
    },

    load_state_from_storage: function() {
        var serialized_state = sessionStorage.getItem(this.get_storage_key());
        if (!serialized_state) {
            return;
        }
        try {
            var state = JSON.parse(serialized_state);
            this.page_size = this.page_size || state.page_size;
            _.extend(this.visibility, state.visibility);
        } catch (ex) {
            // JSON parsing failed, log exception but keep going
            // TODO: find a way to cause tests to fail without breaking the
            // UI.
            console.log(ex);
        }
    },

    load: function(on_success) {
        var self = this;
        if (!self.loading) {
            self.loading = true;
            self.trigger('data_requested');
            self.fetch({
                headers: self.get_request_headers(),
                data: self.get_request_data(),
                reset: true,
                success: function(collection, response, options) {
                    self.loading = false;
                    if (on_success) on_success(collection, response, options);
                },
                error: function(collection, response, options) {
                    self.loading = false;
                    if (response.status == '403') {
                        window.alert('Error: you are not logged in, data cannot be retrieved from the server, ' +
                            'please refresh the page.');
                    }
                }
            });
        }
    },

    reload: function(save_state_to_storage) {
        // Load the collection, unless it hasn't been loaded previously
        // Also pushes the state of the collection to the browser history, for BACK button support
        if (_.keys(this.metadata).length > 0) {
            if (save_state_to_storage) {
                this._save_state_to_url();
            }
            this.load();
        }
    },

    parse: function(response) {
        this.metadata = response.metadata;
        return response.result;
    },

    is_loading: function() {
        return this.loading;
    },

    get_request_headers: function() {
        return {};
    },

    get_request_data: function() {
        return _.extend({sort: this.sort, page: this.page, page_size: this.page_size}, this.filters);
    },

    set_sort: function(sort) {
        if (!this.loading && this.sort != sort) {
            this.sort = sort;
            this.page = 1;
            this.reload(true);
        }
    },

    set_page: function(page) {
        if (!this.loading && this.page != page) {
            this.page = page;
            this.reload(true);
        }
    },

    set_page_size: function(page_size) {
        if (!this.loading && this.page_size != page_size) {
            this.page_size = page_size;
            this.page = 1;
            this.save_state_to_storage();
            this.reload(true);
        }
    },

    set_filters: function(filters) {
        if (!this.loading) {
            this.filters = filters;
            this.page = 1;
            this.reload(true);
        }
    },
});


var DataTable = Backbone.View.extend({

    tagName: "table",

    className: "table table-hover table-bordered infi-datatable",

    events: {
        'change .settings input':         'handle_visibility',
        'click th.sortable':              'handle_sort',
        'click .settings .dropdown-menu': 'prevent_settings_hide',
        'click tbody tr':                 'handle_row_click'
    },

    custom_row_styles: function(model) { return [] },

    row_template:      '<tr tabindex="0" data-row-id="<%- model.id %>" <%= rowClassNameExpression %>>' +
                       '    <% _.each(columns, function(column, index) { %>' +
                       '        <td class="td_<%- column.name %>"><%= values[index] %></td>' +
                       '    <% }) %>' +
                       '</tr>',

    settings_template: '<div class="settings" style="position: absolute; right: 20px; top: 15px; z-index: 100;">' +
                       '    <button type="button" class="btn btn-default btn-xs dropdown-toggle" data-toggle="dropdown"><i class="glyphicon glyphicon-th-list"></i></button>' +
                       '    <div class="panel panel-default dropdown-menu dropdown-menu-right" style="white-space: nowrap; min-width: initial; font-size: inherit">' +
                       '        <% _.each(columns, function(c) { %>' +
                       '            <label class="themed-checkbox" style="display: block; padding: 5px 20px 0 10px;">' +
                       '                <input type="checkbox" <% if (column_visible(c)) print("checked") %> name="<%- c.name %>"><span></span> <%- column_title(c) %></label>' +
                       '        <% }) %>' +
                       '    </div>' +
                       '</div>',

    css_template:      '<% _.each(self.columns, function(c) { %>' +
                       '    .td_<%- c.name %>, .th_<%- c.name %> {' +
                       '        display: <% print(self.column_visible(c) ? "table-cell" : "none") %>;' +
                       '        width: <%- self.column_width(c) %>;' +
                       '    }' +
                       '<% }) %>' +
                       '.infi-datatable { table-layout: fixed; }' +
                       '.infi-datatable caption { padding: 0; }' +
                       '.infi-datatable th .glyphicon-chevron-down { display: none; }' +
                       '.infi-datatable th .glyphicon-chevron-up { display: none; }' +
                       '.infi-datatable th.desc .glyphicon-chevron-down { display: inline-block; }' +
                       '.infi-datatable th.asc .glyphicon-chevron-up { display: inline-block; }',

    download_template: '<div class="modal download-modal" tabindex="-1">' +
                       '    <div class="modal-dialog modal-sm">' +
                       '        <div class="modal-content">' +
                       '            <div class="modal-body">' +
                       '                <p>Preparing Download</p>' +
                       '                <div class="progress">' +
                       '                  <div class="progress-bar progress-bar-striped active"></div>' +
                       '                </div>' +
                       '            </div>' +
                       '            <div class="modal-footer">' +
                       '                <button type="button" class="btn btn-default">Cancel</button>' +
                       '            </div>' +
                       '        </div>' +
                       '    </div>' +
                       '</div>    ',

    initialize: function(options) {
        var self = this;
        self.custom_row_styles = options.custom_row_styles || this.custom_row_styles;
        self.columns = options.columns;
        self.row_click_callback = options.row_click_callback || _.noop;
        _.each(self.columns, function(column) {
            self.collection.visibility[column.name] = _.has(column, 'visible') ? column.visible : true;
        });
        self.collection.on('reset', _.bind(self.render_tbody, self));
        self.collection.on('state:reset state:restore', _.bind(self.handle_collection_state, self));
    },

    /* Rendering */

    render: function() {
        this.$el.html('<caption></caption><thead></thead><tbody></tbody>');
        this.style = $('<style/>');
        $('head').append(this.style);
        this.render_caption();
        this.render_thead();
        this.render_tbody();
        this.render_css();
        this.handle_collection_state();
        return this;
    },

    render_caption: function() {
        var self = this;
        var settings = _.template(self.settings_template)({
            columns: self.columns,
            column_title: self.column_title,
            column_visible: _.bind(self.column_visible, self)
        });
        $('caption', this.el).append(settings);
    },

    render_thead: function() {
        var self = this;
        var thead = $('thead', self.el);
        thead.empty();
        var tr = $('<tr/>');
        thead.append(tr);
        _.each(this.columns, function(column) {
            var title = self.column_title(column);
            var th = $('<th/>').text(title).addClass('th_' + column.name).data('column', column.name);
            if (column.sortable != false) {
                th.addClass('sortable').append('<i class="glyphicon glyphicon-chevron-up"></i><i class="glyphicon glyphicon-chevron-down"></i>');
            }
            tr.append(th);
        });
    },

    render_tbody: function() {
        var self = this;
        var tbody = $('tbody', self.el);
        if (tbody.length == 0) {
            self.render();
        }
        else {
            tbody.empty();
            var template = _.template(self.row_template);
            self.collection.each(function(model) {
                var values = self.row_for_model(model);
                var custom_classes = self.custom_row_styles(model);
                var rowClassNameExpression = custom_classes ?
                    'class="' + custom_classes.join(' ') + '"' : '';
                tbody.append(template({
                  model: model,
                  columns: self.columns,
                  values: values,
                  rowClassNameExpression: rowClassNameExpression
                }));
            });
        }
        self.trigger('data_rendered');
        self.$el.keypress('tr', function(e) {
            if (e.keyCode == 13) {
                $(e.target).click();
                e.stopImmediatePropagation();
                return;
            }
        });
    },

    row_for_model: function(model) {
        // Given a model, returns the array of column values to display
        var values = [];
        _.each(this.columns, function(column) {
            var value = model.get(column.name);
            if (column.render) value = column.render({model: model, column: column, value: value});
            values.push(value);
        });
        return values;
    },

    render_css: function() {
        var template = _.template(this.css_template);
        this.style.html(template({self: this}));
    },

    render_sorting: function(th, asc) {
        // Mark the given th cell as sorted, in ascending or descending order.
        var tr = th.parent();
        tr.find('th').removeClass('asc desc')
        th.addClass(asc ? 'asc' : 'desc');
    },

    /* Getting info about columns */

    column_title: function(column) {
        if (_.has(column, 'title')) return column.title;
        var s = column.name.replace(/_/g, ' ');
        s = s.replace(/\w\S*/g, function(s) {
            return s.charAt(0).toUpperCase() + s.substr(1).toLowerCase();
        });
        return s;
    },

    column_width: function(column) {
        var w = _.has(column, 'width') ? column.width : 'auto';
        if (typeof w === 'number') w += 'px';
        return w;
    },

    column_visible: function(column) {
        return this.collection.visibility[column.name];
    },

    /* Event handlers */

    handle_visibility: function(e) {
        var self = this;
        $('.settings input', this.el).each(function() {
            self.collection.visibility[$(this).attr('name')] = $(this).is(':checked');
        });
        self.collection.save_state_to_storage();
        self.render_css();
    },

    prevent_settings_hide: function(e) {
        e.stopPropagation();
    },

    handle_sort: function(e) {
        if (this.collection.is_loading()) return;
        var th = $(e.target).closest('th');
        var asc = !th.hasClass('asc');
        this.render_sorting(th, asc);
        this.collection.set_sort((asc ? '' : '-') + th.data('column'));
    },

    handle_row_click: function(e) {
        var t = e.target.tagName;
        if (t != 'A' && t != 'BUTTON' && t != 'INPUT') {
            var tr = $(e.target).closest('tr');
            var id = tr.data('row-id');
            var model = this.collection.get(id);
            this.row_click_callback(model);
        }
    },

    handle_collection_state: function() {
        // Mark the sorted column
        var sort = this.collection.sort;
        var asc = true;
        if (sort.startsWith('-')) {
            sort = sort.substr(1);
            asc = false;
        }
        this.render_sorting($('thead .th_' + sort, this.el), asc);
    },

    download: function(filename) {
        // Clone the collection, so that we can download all pages without affecting the real collection
        var self = this;
        var collection = self.collection.clone();
        collection._save_state_to_url = _.noop()
        collection.page_size = 1000;
        // Display the download modal
        $('body').append(_.template(self.download_template)());
        $('.download-modal').modal();
        var cancelled = false;
        $('.download-modal button').on('click', function() {
            cancelled = true;
            $('.download-modal').modal('hide').detach();
        })
        // Start building the data
        var titles = _.map($('th', self.el), $.text);
        var rows = [self.as_csv(titles)];
        // This function is called once all pages were loaded
        function save_downloaded_data() {
            $('.download-modal').modal('hide').detach();
            var blob = new Blob([rows.join('\n')], {type: 'text/csv'});
            saveAs(blob, filename + '.csv'); // implemented by FileSaver.js
        }
        // This function is called recursively to download all pages
        function download_page(page) {
            collection.page = page;
            collection.load(function() {
                if (cancelled) return;
                // Update progress bar
                var progress = 100.0 * collection.metadata.page / collection.metadata.pages_total;
                $('.download-modal .progress-bar').width(progress + '%');
                // Convert the models to CSV rows
                collection.each(function(model) {
                    var values = self.row_for_model(model);
                    rows.push(self.as_csv(values));
                });
                // Continue to next page or finish
                if (collection.metadata.next) {
                    download_page(page + 1);
                }
                else {
                    save_downloaded_data();
                }
            });
        };
        // Initiate the download
        download_page(1);
    },

    as_csv: function(values) {
        // Convert an array of values to a CSV string, stripping any HTML tags
        var row = '<div>"' + values.join('","') + '"</div>';
        return $(row).text();
    }

});


var DataTablePaginator = Backbone.View.extend({

    tagName: 'nav',
    className: 'infi-datatable-paginator',
    show_settings: true,
    is_primary: true,
    page_sizes: [10, 30, 100],

    template: '&nbsp;<div class="btn-group" style="display: inline; float: right;">' +
              '    <button type="button" class="btn btn-default dropdown-toggle" data-toggle="dropdown">' +
              '        <i class="glyphicon glyphicon-cog"></i>' +
              '    </button>' +
              '    <ul class="dropdown-menu dropdown-menu-right">' +
              '        <% _.each(page_sizes, function(size) { %>' +
              '            <li><a href="#" class="menu-page-size" data-size="<%= size %>">Page Size: <%= size %></i></a></li>' +
              '        <% }); %>' +
              '    </ul>' +
              '</div>',

    events: {
        'click .menu-page-size': 'handle_page_size',
    },

    initialize: function(options) {
        this.collection.on('reset', _.bind(this.render, this));
        if (options) {
            if (_.has(options, 'is_primary')) {
                this.is_primary = options.is_primary;
            }
            if (_.has(options, 'show_settings')) {
                this.show_settings = options.show_settings;
            } else {
                this.show_settings = this.is_primary;
            }
            if (_.has(options, 'page_sizes')) {
                this.page_sizes = options.page_sizes;
            }
        }
    },

    render: function() {
        var self = this;
        self.$el.empty();
        if (self.collection.metadata.pages_total > 1) {
            self.$el.bootpag({
                total: self.collection.metadata.pages_total,
                page: self.collection.metadata.page,
                maxVisible: 5,
                firstLastUse: true,
                leaps: false,
                wrapClass: 'pagination',
                first: '<i class="glyphicon glyphicon-step-backward"></i>',
                last: '<i class="glyphicon glyphicon-step-forward">',
                prev: '<i class="glyphicon glyphicon-backward"></i>',
                next: '<i class="glyphicon glyphicon-forward"></i>',
            }).on('page', function(event, num) {
                self.collection.set_page(num);
            });
            self.$el.on('keypress', function(e) {
                if (e.keyCode == 'k'.charCodeAt(0) ) {
                    self.collection.set_page(
                        Math.min(self.collection.metadata.pages_total, self.collection.page + 1));
                    e.stopImmediatePropagation();
                    return;
                }
                if (e.keyCode == 'j'.charCodeAt(0)) {
                    self.collection.set_page(Math.max(1, self.collection.page - 1)) ;
                    e.stopImmediatePropagation();
                    return;
                }
            });
        }
        if (self.show_settings) {
            var settings = _.template(self.template)({page_sizes: self.page_sizes});
            self.$el.append(settings);
        }
        self.mark_current_page_size();
    },

    mark_current_page_size: function() {
        var size = this.collection.page_size;
        $('.menu-page-size', this.el).each(function() {
            var a = $(this);
            a.find('i').detach();
            if (a.attr('data-size') == size) {
                a.append(' <i class="glyphicon glyphicon-ok"></i>');
            }
        });
    },

    handle_page_size: function(e) {
        e.preventDefault();
        var size = $(e.target).attr('data-size');
        this.collection.set_page_size(size);
    }

});


var DataTableCounter = Backbone.View.extend({

    tagName: 'span',
    className: "infi-datatable-counter",

    initialize: function(options) {
        this.collection.on('reset', _.bind(this.render, this));
    },

    render: function() {
        var self = this;
        var metadata = self.collection.metadata;
        var count = metadata.number_of_objects.toLocaleString();
        if (metadata.limited_number_of_objects && metadata.page < metadata.pages_total) {
            count = ">" + count;
        }
        else if (metadata.approximated_number_of_objects && metadata.page < metadata.pages_total) {
            count = "~" + count;
        }
        self.$el.text(count);
    }

});


var DataTableSimpleQuery = Backbone.View.extend({

    className: "infi-datatable-simple-query",

    template: '<div class="form-group has-feedback">' +
              '    <input name="<%= field_name %>" placeholder="Search" class="form-control" maxlength="50" value="<%= field_value %>">' +
              '    <span class="glyphicon glyphicon-search form-control-feedback"></span>' +
              '</div>',

    events: {
        'input': 'handle_change'
    },

    initialize: function(options) {
        this.field_name = options.field_name || 'q';
        this.collection.on('state:reset state:restore', _.bind(this.handle_collection_state, this));

    },

    render: function() {
        var html = _.template(this.template)({
            field_name: this.field_name,
            field_value: this.collection.filters[this.field_name] || ''
        });
        this.$el.html(html);
    },

    handle_change: _.debounce(
        function(e) {
            this.apply_to_collection();
        },
        300
    ),

    get_query_params: function() {
        var params = {}
        params[this.field_name] = this.$el.find('input').val();
        return params;
    },

    apply_to_collection: function() {
        this.collection.set_filters(this.get_query_params());
    },

    handle_collection_state: function() {
        // Update the contents of the search field
        $('input', this.el).val(this.collection.filters[this.field_name]);
    }

});


var DataTableQueryBuilder = Backbone.View.extend({

    className: "infi-datatable-query-builder",

    operators: [
        {type: 'contains',     to_api: 'like',      nb_inputs: 1, multiple: false, apply_to: ['string']},
        {type: 'not_contains', to_api: 'unlike',    nb_inputs: 1, multiple: false, apply_to: ['string']},
        {type: '=',            to_api: 'eq',        nb_inputs: 1, multiple: false, apply_to: ['string', 'number', 'boolean']},
        {type: '!=',           to_api: 'ne',        nb_inputs: 1, multiple: false, apply_to: ['string', 'number', 'boolean']},
        {type: '<',            to_api: 'lt',        nb_inputs: 1, multiple: false, apply_to: ['number', 'datetime']},
        {type: '<=',           to_api: 'le',        nb_inputs: 1, multiple: false, apply_to: ['number', 'datetime']},
        {type: '>',            to_api: 'gt',        nb_inputs: 1, multiple: false, apply_to: ['number', 'datetime']},
        {type: '>=',           to_api: 'ge',        nb_inputs: 1, multiple: false, apply_to: ['number', 'datetime']},
        {type: 'in',           to_api: 'in',        nb_inputs: 1, multiple: true,  apply_to: []},
        {type: 'not_in',       to_api: 'out',       nb_inputs: 1, multiple: true,  apply_to: []},
        {type: 'between',      to_api: 'between',   nb_inputs: 2, multiple: false, apply_to: ['number', 'datetime']},
        {type: 'isnull',       to_api: 'isnull',    nb_inputs: 1, multiple: false, apply_to: ['number', 'string', 'datetime', 'boolean']},
    ],

    initialize: function(options) {
        this.filter_fields = options.filter_fields;
        this.collection.on('state:reset state:restore', _.bind(this.handle_collection_state, this));
    },

    render: function() {
        this.$el.queryBuilder({
            filters: this.filter_fields,
            operators: this.operators,
            plugins: {
                'bt-tooltip-errors': { delay: 100 },
                'filter-description': {}
            },
            allow_empty: true,
            allow_groups: false,
            conditions: ['AND'],
            lang: {  "delete_rule": "Remove",
                     "delete_group": "Remove"}
        });
        this.handle_collection_state();
    },

    update_filter: function(options, field_name) {
        for (var i = 0; i < this.filter_fields.length; i++) {
            filter_field = this.filter_fields[i];
            if (filter_field.id == field_name) {
                $.extend(filter_field, options);
                return;
            }
        }
        alert('Cannot update filter field ' + field_name);
    },

    get_rules: function() {
        return this.$el.queryBuilder('getRules');
    },

    set_rules: function(rules) {
        return this.$el.queryBuilder('setRules', rules);
    },

    validate: function() {
        return this.$el.queryBuilder('validate');
    },

    operator_to_api: function(operator) {
        // Convert Query Builder operator name to API operator name
        return _.findWhere(this.operators, {type: operator}).to_api;
    },

    api_to_operator: function(api_op) {
        // Convert API operator name to Query Builder operator name
        return _.findWhere(this.operators, {to_api: api_op}).type;
    },

    get_query_params: function() {
        // Convert the current rules into API query params
        var self = this;
        var rules = self.get_rules();
        var params = {}
        _.each(rules.rules, function(rule) {
            params[rule.id] = self.operator_to_api(rule.operator) + ':' + rule.value.toString();
        });
        return params
    },

    apply_to_collection: function() {
        if (this.validate()) {
            this.collection.set_filters(this.get_query_params());
        }
    },

    handle_collection_state: function() {
        // Convert the collection's filters into Query Builder rules
        var self = this;
        var rules = [];
        var filter_field_names = _.pluck(this.filter_fields, 'id');
        _.each(self.collection.filters, function(value, key) {
            if (_.indexOf(filter_field_names, key) == -1) return; // skip unknown field names
            var colon_location = value.indexOf(':');
            if (colon_location == -1) {
                operator = 'eq';
            } else {
                var operator = value.slice(0, colon_location);
                var value = value.slice(colon_location + 1);
            }
            if (operator == 'in' || operator == 'out' || operator == 'between') {
                value = value.split(',');
            }
            rules.push({
                id: key,
                operator: self.api_to_operator(operator),
                value: value
            });
        });
        // Initialize the Query Builder
        if (rules.length) {
            self.$el.queryBuilder('setRules', {condition: 'AND', rules: rules});
        }
        else {
            self.$el.queryBuilder('reset');
        }
    }
});
